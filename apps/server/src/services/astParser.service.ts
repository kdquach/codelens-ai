import {
  Project,
  SourceFile,
  SyntaxKind,
  FunctionDeclaration,
  ClassDeclaration,
  VariableStatement,
  VariableDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  EnumDeclaration,
  Node,
} from 'ts-morph';
import path from 'path';
import {
  ArchitectureGraph,
  GraphNode,
  GraphEdge,
  NodeCategory,
} from '@codelens/shared';
import { RawRepoFile } from './github.service';

// ─────────────────────────────────────────────────────────────
// AST Parser Service — Phân tích kiến trúc bằng ts-morph
// Input:  RawRepoFile[] (từ GitHubService)
// Output: ArchitectureGraph (nodes/edges) + ParsedChunk[]
// ─────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────

/** Một code chunk đã bóc tách – sẽ lưu vào MongoDB & tạo embedding. */
export interface ParsedChunk {
  filePath: string;
  symbolName: string;
  symbolType: 'FUNCTION' | 'CLASS' | 'COMPONENT' | 'FILE';
  startLine: number;
  endLine: number;
  content: string;
  dependencies: string[];
}

/** Kết quả trả về sau khi phân tích toàn bộ repository. */
export interface ParseResult {
  graph: ArchitectureGraph;
  chunks: ParsedChunk[];
}

// ── Hằng số cấu hình ────────────────────────────────────────

/** Giới hạn nội dung chunk để tránh embedding quá lớn (4000 ký tự). */
const MAX_CHUNK_CONTENT_LENGTH = 4000;

/**
 * Nếu một symbol quá dài (> 200 dòng), cắt thành sub-chunks.
 * Mỗi sub-chunk ~ 100 dòng, overlap 10 dòng.
 */
const LARGE_SYMBOL_LINE_THRESHOLD = 200;
const SUB_CHUNK_SIZE_LINES = 100;
const SUB_CHUNK_OVERLAP_LINES = 10;

// Các extension cần thử khi resolve import path
const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

// ── Service chính ────────────────────────────────────────────

export class AstParserService {
  // ┌──────────────────────────────────────────────────────────┐
  // │  Entry point: Phân tích toàn bộ repository              │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Phân tích mã nguồn repository:
   * 1. Tạo ts-morph Project trên InMemory FileSystem (RAM-only, không cần disk)
   * 2. Duyệt AST từng file → Tạo GraphNode + trích xuất imports → GraphEdge
   * 3. Bóc tách Functions, Classes, Arrow Function Exports, Interfaces...
   *    thành các code_chunks riêng biệt
   * 4. Loại trùng edges, validate graph
   *
   * @param files - Danh sách file thô từ GitHubService
   * @returns ParseResult { graph, chunks }
   */
  static parseRepository(files: RawRepoFile[]): ParseResult {
    if (files.length === 0) {
      return { graph: { nodes: [], edges: [] }, chunks: [] };
    }

    // Khởi tạo ts-morph hoàn toàn trên RAM (bật skipFileDependencyResolution để tiết kiệm RAM & tăng tốc)
    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: {
        allowJs: true,
        jsx: 4, // JsxEmit.ReactJSX
        strict: false, // Lỏng hơn để parse nhiều repo style
        skipLibCheck: true,
        noEmit: true,
      },
    });

    // Tập hợp đường dẫn file để resolve imports
    const fileSet = new Set(files.map((f) => f.path));

    // Tạo source files trong project
    for (const file of files) {
      try {
        project.createSourceFile(file.path, file.content);
      } catch (error: unknown) {
        console.warn(
          `⚠️ [AstParser] Không thể tạo SourceFile cho "${file.path}": ${String(error)}`
        );
      }
    }

    const nodes: GraphNode[] = [];
    const edgeMap = new Map<string, GraphEdge>(); // Dùng Map để tự loại trùng
    const chunks: ParsedChunk[] = [];

    // ── Duyệt từng file ──
    for (const sourceFile of project.getSourceFiles()) {
      try {
        const filePath = this.normalizeFilePath(sourceFile.getFilePath());
        const loc = sourceFile.getEndLineNumber();

        // ── Tạo GraphNode cho file ──
        nodes.push({
          id: filePath,
          label: path.basename(filePath),
          category: this.detectCategory(filePath),
          loc,
        });

        // ── Trích xuất imports → edges + dependencies ──
        const dependencies = this.extractImports(
          sourceFile,
          filePath,
          fileSet,
          edgeMap,
        );

        // ── Bóc tách symbols thành chunks ──
        const fileChunks = this.extractChunksFromFile(
          sourceFile,
          filePath,
          dependencies,
        );

        chunks.push(...fileChunks);
      } catch (error: unknown) {
        console.warn(
          `⚠️ [AstParser] Lỗi khi phân tích "${sourceFile.getFilePath()}": ${String(error)}`
        );
      }
    }

    // Chuyển edgeMap → mảng
    const edges = Array.from(edgeMap.values());

    console.log(
      `✅ [AstParser] Parsed ${nodes.length} nodes, ${edges.length} edges, ${chunks.length} chunks`
    );

    return { graph: { nodes, edges }, chunks };
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Trích xuất imports → dependencies + edges              │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Duyệt tất cả ImportDeclaration trong file:
   * - Import tương đối (./ ../) → resolve thành đường dẫn thực → tạo edge
   * - Import package (node_modules) → bỏ qua (không thuộc codebase)
   *
   * Cũng xử lý dynamic import: `import('./module')` và re-exports:
   * `export { X } from './module'`
   */
  private static extractImports(
    sourceFile: SourceFile,
    filePath: string,
    fileSet: Set<string>,
    edgeMap: Map<string, GraphEdge>,
  ): string[] {
    const dependencies: string[] = [];
    const addedDeps = new Set<string>(); // Tránh trùng dependency

    // ── 1. Static imports: import { X } from './module' ──
    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpec = imp.getModuleSpecifierValue();
      this.tryResolveAndAddEdge(
        moduleSpec,
        filePath,
        fileSet,
        edgeMap,
        dependencies,
        addedDeps,
      );
    }

    // ── 2. Re-exports: export { X } from './module' ──
    for (const exp of sourceFile.getExportDeclarations()) {
      const moduleSpec = exp.getModuleSpecifierValue();
      if (moduleSpec) {
        this.tryResolveAndAddEdge(
          moduleSpec,
          filePath,
          fileSet,
          edgeMap,
          dependencies,
          addedDeps,
        );
      }
    }

    // ── 3. Dynamic imports: import('./module') ──
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
      const expr = call.getExpression();
      if (expr.getKind() === SyntaxKind.ImportKeyword) {
        const args = call.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          const moduleSpec = args[0].getLiteralValue();
          this.tryResolveAndAddEdge(
            moduleSpec,
            filePath,
            fileSet,
            edgeMap,
            dependencies,
            addedDeps,
          );
        }
      }
    });

    return dependencies;
  }

  /**
   * Kiểm tra và resolve import path (hỗ trợ relative ./ ../, alias @/ ~/, và root src/) → thêm edge.
   */
  private static tryResolveAndAddEdge(
    moduleSpec: string,
    filePath: string,
    fileSet: Set<string>,
    edgeMap: Map<string, GraphEdge>,
    dependencies: string[],
    addedDeps: Set<string>,
  ): void {
    // Chỉ bỏ qua các third-party package rõ ràng như 'react', 'lodash', 'express'...
    // nhưng cho phép alias (@/, ~/), relative (./, ../), hoặc path bắt đầu bằng src/
    const isLocalSpec =
      moduleSpec.startsWith('.') ||
      moduleSpec.startsWith('@/') ||
      moduleSpec.startsWith('~/') ||
      moduleSpec.startsWith('src/');

    if (!isLocalSpec) {
      // Thử kiểm tra xem có khớp với file nào trong codebase không (VD: import 'components/Button')
      const directCandidate = this.resolveImportPath(filePath, moduleSpec, fileSet);
      if (!directCandidate) return;
    }

    const resolvedPath = this.resolveImportPath(filePath, moduleSpec, fileSet);
    if (resolvedPath && resolvedPath !== filePath && !addedDeps.has(resolvedPath)) {
      addedDeps.add(resolvedPath);
      dependencies.push(resolvedPath);

      const edgeId = `${filePath}->${resolvedPath}`;
      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, {
          id: edgeId,
          source: filePath,
          target: resolvedPath,
        });
      }
    }
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Bóc tách symbols → code chunks                         │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Trích xuất tất cả symbols đáng lưu trữ từ 1 file:
   * 1. Function declarations (named)
   * 2. Class declarations
   * 3. Arrow function exports (const Xxx = () => ...)
   * 4. Interfaces & Type aliases (để RAG hiểu cấu trúc dữ liệu)
   * 5. Enums
   * 6. Fallback: file-level chunk nếu không có symbol tường minh nào
   */
  private static extractChunksFromFile(
    sourceFile: SourceFile,
    filePath: string,
    dependencies: string[],
  ): ParsedChunk[] {
    const chunks: ParsedChunk[] = [];

    // Theo dõi các dòng đã bóc tách để quyết định fallback
    let hasExtractedSymbols = false;

    // ── 1. Named Function Declarations ──
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName();
      if (!name) continue; // Bỏ qua anonymous functions

      const chunk = this.createChunkFromNode(
        func,
        filePath,
        name,
        this.classifyFunctionSymbolType(name, filePath),
        dependencies,
      );

      if (chunk) {
        chunks.push(...this.maybeSplitLargeChunk(chunk));
        hasExtractedSymbols = true;
      }
    }

    // ── 2. Class Declarations ──
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() || 'AnonymousClass';

      const chunk = this.createChunkFromNode(
        cls,
        filePath,
        name,
        'CLASS',
        dependencies,
      );

      if (chunk) {
        chunks.push(...this.maybeSplitLargeChunk(chunk));
        hasExtractedSymbols = true;
      }
    }

    // ── 3. Arrow Function / Variable Exports ──
    // Bắt: export const MyComponent = () => { ... }
    //       export const handler = async (req, res) => { ... }
    //       const useStore = create<Store>((set) => ({ ... }))
    const arrowChunks = this.extractArrowFunctionExports(
      sourceFile,
      filePath,
      dependencies,
    );
    if (arrowChunks.length > 0) {
      chunks.push(...arrowChunks);
      hasExtractedSymbols = true;
    }

    // ── 4. Interfaces & Type Aliases (hữu ích cho RAG context) ──
    const typeChunks = this.extractTypeDefinitions(
      sourceFile,
      filePath,
      dependencies,
    );
    if (typeChunks.length > 0) {
      chunks.push(...typeChunks);
      // Không đặt hasExtractedSymbols = true vì types đơn lẻ
      // chưa đủ đại diện cho nội dung chính
    }

    // ── 5. Enum Declarations ──
    for (const enumDecl of sourceFile.getEnums()) {
      const name = enumDecl.getName();
      const chunk = this.createChunkFromNode(
        enumDecl,
        filePath,
        name,
        'FILE', // Enum xếp loại FILE cho đơn giản
        dependencies,
      );
      if (chunk) {
        chunks.push(chunk);
        hasExtractedSymbols = true;
      }
    }

    // ── 6. Fallback: File-level chunk ──
    // Nếu file không có function/class/arrow nào tường minh
    // (VD: config files, barrel exports, constants...)
    if (!hasExtractedSymbols) {
      const fullText = sourceFile.getFullText();
      const loc = sourceFile.getEndLineNumber();

      chunks.push({
        filePath,
        symbolName: path.basename(filePath),
        symbolType: 'FILE',
        startLine: 1,
        endLine: loc,
        content: this.truncateContent(fullText),
        dependencies,
      });
    }

    return chunks;
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Arrow Function Exports                                 │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Trích xuất arrow function exports – pattern phổ biến trong React/Next.js:
   *
   * ```ts
   * export const MyComponent = ({ props }) => { ... }
   * export const useCustomHook = () => { ... }
   * export default function Page() { ... }   // Đã xử lý ở mục 1
   * const handler = async (req, res) => { ... }  // Top-level kèm export
   * ```
   */
  private static extractArrowFunctionExports(
    sourceFile: SourceFile,
    filePath: string,
    dependencies: string[],
  ): ParsedChunk[] {
    const chunks: ParsedChunk[] = [];

    // Tập hợp tên function declarations đã xử lý → tránh trùng
    const processedNames = new Set(
      sourceFile.getFunctions().map((f) => f.getName()).filter(Boolean),
    );

    for (const varStatement of sourceFile.getVariableStatements()) {
      // Chỉ quan tâm các khai báo exported hoặc top-level có ý nghĩa
      const isExported = varStatement.isExported();

      for (const declaration of varStatement.getDeclarations()) {
        const name = declaration.getName();
        if (processedNames.has(name)) continue;

        const initializer = declaration.getInitializer();
        if (!initializer) continue;

        // Kiểm tra xem initializer có phải arrow function / function expression
        // hoặc call expression trả về function (VD: create<Store>(...), memo(...))
        const isArrowOrFuncExpr =
          Node.isArrowFunction(initializer) ||
          Node.isFunctionExpression(initializer);

        const isCallReturningFunc =
          Node.isCallExpression(initializer) &&
          this.isHighOrderFunctionCall(initializer.getExpression().getText());

        if (!isArrowOrFuncExpr && !isCallReturningFunc) continue;

        // Chỉ lấy exported hoặc các hàm/component PascalCase (likely component)
        if (!isExported && !/^[A-Z]/.test(name)) continue;

        const symbolType = this.classifyFunctionSymbolType(name, filePath);

        const chunk = this.createChunkFromNode(
          varStatement, // Lấy toàn bộ statement (bao gồm export keyword)
          filePath,
          name,
          symbolType,
          dependencies,
        );

        if (chunk) {
          chunks.push(...this.maybeSplitLargeChunk(chunk));
          processedNames.add(name);
        }
      }
    }

    return chunks;
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Type Definitions (Interfaces, Type Aliases)            │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Trích xuất interfaces và type aliases – bổ sung context cho RAG:
   * - Nhóm tất cả types trong 1 file thành 1 chunk (nếu < threshold)
   * - Hoặc tách riêng nếu interface/type đủ lớn (> 20 dòng)
   */
  private static extractTypeDefinitions(
    sourceFile: SourceFile,
    filePath: string,
    dependencies: string[],
  ): ParsedChunk[] {
    const chunks: ParsedChunk[] = [];

    const interfaces = sourceFile.getInterfaces();
    const typeAliases = sourceFile.getTypeAliases();

    if (interfaces.length === 0 && typeAliases.length === 0) return chunks;

    // Xử lý interface lớn (> 20 dòng) riêng
    for (const iface of interfaces) {
      const lineCount =
        iface.getEndLineNumber() - iface.getStartLineNumber() + 1;

      if (lineCount > 20) {
        const chunk = this.createChunkFromNode(
          iface,
          filePath,
          iface.getName(),
          'FILE', // Type definitions → FILE category
          dependencies,
        );
        if (chunk) chunks.push(chunk);
      }
    }

    // Gom các type nhỏ thành 1 chunk "TypeDefinitions"
    const smallTypes: string[] = [];

    for (const iface of interfaces) {
      const lineCount =
        iface.getEndLineNumber() - iface.getStartLineNumber() + 1;
      if (lineCount <= 20) {
        smallTypes.push(iface.getText());
      }
    }

    for (const typeAlias of typeAliases) {
      smallTypes.push(typeAlias.getText());
    }

    if (smallTypes.length > 0) {
      const combined = smallTypes.join('\n\n');
      chunks.push({
        filePath,
        symbolName: `TypeDefinitions<${path.basename(filePath)}>`,
        symbolType: 'FILE',
        startLine: 1,
        endLine: sourceFile.getEndLineNumber(),
        content: this.truncateContent(combined),
        dependencies,
      });
    }

    return chunks;
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Utilities nội bộ                                       │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Tạo ParsedChunk từ một AST Node bất kỳ.
   * Trả về null nếu node trống hoặc quá ngắn (< 2 dòng).
   */
  private static createChunkFromNode(
    node: FunctionDeclaration | ClassDeclaration | VariableStatement |
      InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration,
    filePath: string,
    symbolName: string,
    symbolType: ParsedChunk['symbolType'],
    dependencies: string[],
  ): ParsedChunk | null {
    try {
      const text = node.getText();
      const startLine = node.getStartLineNumber();
      const endLine = node.getEndLineNumber();

      // Bỏ qua symbol quá ngắn (1 dòng, VD: `export type X = string;`)
      if (endLine - startLine < 1 && text.length < 50) return null;

      return {
        filePath,
        symbolName,
        symbolType,
        startLine,
        endLine,
        content: this.truncateContent(text),
        dependencies: [...dependencies], // Clone để mỗi chunk có mảng riêng
      };
    } catch (error: unknown) {
      console.warn(
        `⚠️ [AstParser] Lỗi khi tạo chunk "${symbolName}" trong "${filePath}": ${String(error)}`
      );
      return null;
    }
  }

  /**
   * Nếu chunk quá dài (> LARGE_SYMBOL_LINE_THRESHOLD dòng),
   * cắt thành nhiều sub-chunks có overlap.
   * Đảm bảo mỗi sub-chunk vẫn có đủ context cho embedding.
   */
  private static maybeSplitLargeChunk(chunk: ParsedChunk): ParsedChunk[] {
    const totalLines = chunk.endLine - chunk.startLine + 1;

    if (totalLines <= LARGE_SYMBOL_LINE_THRESHOLD) {
      return [chunk];
    }

    const lines = chunk.content.split('\n');
    const subChunks: ParsedChunk[] = [];

    const step = Math.max(1, SUB_CHUNK_SIZE_LINES - SUB_CHUNK_OVERLAP_LINES);
    let offset = 0;
    let partIndex = 1;

    while (offset < lines.length) {
      const end = Math.min(offset + SUB_CHUNK_SIZE_LINES, lines.length);
      const subContent = lines.slice(offset, end).join('\n');

      subChunks.push({
        filePath: chunk.filePath,
        symbolName: `${chunk.symbolName}#part${partIndex}`,
        symbolType: chunk.symbolType,
        startLine: chunk.startLine + offset,
        endLine: chunk.startLine + end - 1,
        content: this.truncateContent(subContent),
        dependencies: chunk.dependencies,
      });

      if (end >= lines.length) {
        break; // Đã đạt tới dòng cuối cùng, thoát an toàn
      }

      offset += step;
      partIndex++;
    }

    return subChunks;
  }

  /**
   * Phân loại symbol type dựa trên tên và đường dẫn file:
   * - PascalCase + (.tsx|.jsx) → COMPONENT (React component)
   * - useXxx → FUNCTION (custom hook)
   * - camelCase → FUNCTION
   */
  private static classifyFunctionSymbolType(
    name: string,
    filePath: string,
  ): ParsedChunk['symbolType'] {
    const isJSX = /\.(tsx|jsx)$/.test(filePath);

    // React component: PascalCase trong file .tsx/.jsx
    if (/^[A-Z]/.test(name) && isJSX) return 'COMPONENT';

    // Provider, Layout, Page patterns trong Next.js
    if (/^(use[A-Z]|with[A-Z])/.test(name)) return 'FUNCTION';

    // PascalCase trong file .ts cũng có thể là component (re-export pattern)
    if (/^[A-Z]/.test(name)) return 'COMPONENT';

    return 'FUNCTION';
  }

  /**
   * Kiểm tra xem call expression có phải HOF phổ biến
   * (memo, forwardRef, createContext, create (zustand), connect (redux)...).
   */
  private static isHighOrderFunctionCall(exprText: string): boolean {
    const hocPatterns = [
      'memo',
      'React.memo',
      'forwardRef',
      'React.forwardRef',
      'createContext',
      'React.createContext',
      'create',          // Zustand: create<Store>(...)
      'createStore',
      'connect',         // Redux: connect(mapState)(Component)
      'styled',          // styled-components
      'observer',        // MobX
      'defineComponent', // Vue-style
    ];
    return hocPatterns.some(
      (p) => exprText === p || exprText.endsWith(`.${p}`),
    );
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Category Detection (cho Graph Node)                    │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Phân loại NodeCategory dựa trên đường dẫn file.
   * Ưu tiên: pattern cụ thể hơn → kiểm tra trước.
   */
  static detectCategory(filePath: string): NodeCategory {
    const lower = filePath.toLowerCase();
    const basename = path.basename(lower);

    // ── Đặc biệt: file cấu hình / middleware / router ──
    if (
      lower.includes('controller') ||
      lower.includes('/routes/') ||
      lower.includes('/route/') ||
      basename.startsWith('route.') ||
      lower.includes('middleware') ||
      lower.includes('/api/')  // Next.js API routes
    ) {
      return 'controller';
    }

    // ── Service / Use-case / Repository pattern ──
    if (
      lower.includes('service') ||
      lower.includes('usecase') ||
      lower.includes('use-case') ||
      lower.includes('provider') ||
      lower.includes('repository') && !lower.includes('model')
    ) {
      return 'service';
    }

    // ── Model / Schema / Entity / Migration ──
    if (
      lower.includes('model') ||
      lower.includes('schema') ||
      lower.includes('entity') ||
      lower.includes('migration') ||
      lower.includes('.dto.')
    ) {
      return 'model';
    }

    // ── React/Vue Component ──
    if (
      lower.includes('/components/') ||
      lower.includes('/component/') ||
      lower.includes('/pages/') ||
      lower.includes('/views/') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.jsx')
    ) {
      return 'component';
    }

    // ── Utility / Helper / Lib / Hook ──
    if (
      lower.includes('util') ||
      lower.includes('helper') ||
      lower.includes('/lib/') ||
      lower.includes('/hooks/') ||
      lower.includes('/hook/') ||
      lower.includes('constant') ||
      lower.includes('config')
    ) {
      return 'util';
    }

    return 'other';
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Import Path Resolution                                 │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Resolve import tương đối, alias (@/, ~/) hoặc module path thành file thực trong repo.
   * Hỗ trợ:
   * - Relative: `./foo`, `../bar`
   * - Alias: `@/components/Button` -> `src/components/Button.tsx`
   * - TS ESM .js mapping: `import './foo.js'` -> `foo.ts`
   */
  private static resolveImportPath(
    currentFile: string,
    importSpec: string,
    fileSet: Set<string>,
  ): string | null {
    const candidateBases: string[] = [];

    if (importSpec.startsWith('.')) {
      // Relative import
      const dir = path.posix.dirname(currentFile);
      candidateBases.push(path.posix.normalize(path.posix.join(dir, importSpec)));
    } else if (importSpec.startsWith('@/') || importSpec.startsWith('~/')) {
      // Alias import (@/ hoặc ~/)
      const stripped = importSpec.slice(2);
      candidateBases.push(path.posix.normalize(`src/${stripped}`));
      candidateBases.push(path.posix.normalize(stripped));
    } else {
      // Direct repo path: 'src/...', 'components/...'
      candidateBases.push(path.posix.normalize(importSpec));
      candidateBases.push(path.posix.normalize(`src/${importSpec}`));
    }

    for (const baseTarget of candidateBases) {
      // 1. Thử khớp trực tiếp với các extension
      for (const ext of RESOLVE_EXTENSIONS) {
        const candidate = baseTarget + ext;
        if (fileSet.has(candidate)) return candidate;
      }

      // 2. ESM TypeScript fix: nếu import kết thúc bằng .js, thử thay bằng .ts / .tsx
      if (baseTarget.endsWith('.js')) {
        const tsBase = baseTarget.slice(0, -3);
        for (const ext of ['.ts', '.tsx', '.d.ts']) {
          const candidate = tsBase + ext;
          if (fileSet.has(candidate)) return candidate;
        }
      }
      if (baseTarget.endsWith('.jsx')) {
        const tsxBase = baseTarget.slice(0, -4);
        if (fileSet.has(tsxBase + '.tsx')) return tsxBase + '.tsx';
      }
    }

    return null;
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Helpers                                                │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Chuẩn hóa đường dẫn file từ ts-morph (loại bỏ leading `/`).
   * ts-morph InMemoryFileSystem luôn prefix `/` cho file path.
   */
  private static normalizeFilePath(rawPath: string): string {
    return rawPath.replace(/^\//, '');
  }

  /**
   * Cắt ngắn nội dung nếu vượt quá MAX_CHUNK_CONTENT_LENGTH.
   * Giữ nguyên phần đầu + thêm marker `// ... [TRUNCATED]`.
   */
  private static truncateContent(text: string): string {
    if (text.length <= MAX_CHUNK_CONTENT_LENGTH) return text;

    const truncated = text.slice(0, MAX_CHUNK_CONTENT_LENGTH);
    // Cắt tại cuối dòng gần nhất để không bẻ ngang dòng code
    const lastNewline = truncated.lastIndexOf('\n');
    const cleanCut =
      lastNewline > MAX_CHUNK_CONTENT_LENGTH * 0.8
        ? truncated.slice(0, lastNewline)
        : truncated;

    return cleanCut + '\n// ... [TRUNCATED]';
  }
}
