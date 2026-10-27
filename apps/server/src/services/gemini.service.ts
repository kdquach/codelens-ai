// apps/server/src/services/gemini.service.ts
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Danh sách các model fallback cho text generation
const GENERATION_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
].filter(Boolean) as string[];

export class GeminiService {
  /**
   * Tạo Vector Embedding 768 chiều cho đoạn mã hoặc câu hỏi
   * Sử dụng text-embedding-004 (cấu hình outputDimensionality: 768)
   * và tự động fallback sang gemini-embedding-001 nếu model chưa khả dụng
   */
  static async createEmbedding(text: string): Promise<number[]> {
    const cleanedText = (text || '').trim().slice(0, 3000);
    if (!cleanedText) {
      return new Array(768).fill(0);
    }

    // 1. Thử text-embedding-004 trước theo quy chuẩn
    try {
      const response = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: cleanedText,
        config: { outputDimensionality: 768 },
      });
      const values = response.embeddings?.[0]?.values;
      if (values && values.length === 768) {
        return values;
      }
    } catch {
      // Fallback sang gemini-embedding-001
    }

    // 2. Fallback sang gemini-embedding-001 với outputDimensionality: 768
    try {
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: cleanedText,
        config: { outputDimensionality: 768 },
      });
      return response.embeddings?.[0]?.values || new Array(768).fill(0);
    } catch (err: any) {
      console.warn(`⚠️ [GeminiService.createEmbedding] Lỗi tạo vector: ${err.message}`);
      return new Array(768).fill(0);
    }
  }

  /**
   * Tạo Vector Embeddings theo lô (Batch Embeddings)
   */
  static async createBatchEmbeddings(texts: string[], batchSize = 5): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchVectors = await Promise.all(batch.map((t) => this.createEmbedding(t)));
      results.push(...batchVectors);
    }
    return results;
  }

  /**
   * Stream câu trả lời qua Gemini với cơ chế tự động chuyển đổi Model (Fallback Resilience)
   */
  static async streamGenerate(options: {
    prompt: string;
    systemInstruction?: string;
    onToken: (token: string) => void;
  }): Promise<string> {
    const { prompt, systemInstruction, onToken } = options;
    let fullResponse = '';
    let lastError: any = null;

    for (const model of GENERATION_MODELS) {
      try {
        const stream = await ai.models.generateContentStream({
          model,
          contents: prompt,
          config: systemInstruction ? { systemInstruction } : undefined,
        });

        for await (const chunk of stream) {
          if (chunk.text) {
            fullResponse += chunk.text;
            onToken(chunk.text);
          }
        }

        // Nếu stream thành công, kết thúc hàm
        return fullResponse;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ [GeminiService.streamGenerate] Model "${model}" gặp lỗi: ${err.message}. Thử model tiếp theo...`);
      }
    }

    throw new Error(`Tất cả các Gemini models đều không phản hồi: ${lastError?.message || 'Lỗi không xác định'}`);
  }

  /**
   * Sinh nội dung không streaming (Dùng cho PR Review, Code Summary)
   */
  static async generateContent(prompt: string, systemInstruction?: string): Promise<string> {
    let lastError: any = null;

    for (const model of GENERATION_MODELS) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: systemInstruction ? { systemInstruction } : undefined,
        });
        if (res.text) return res.text;
      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ [GeminiService.generateContent] Model "${model}" lỗi: ${err.message}`);
      }
    }

    throw new Error(`Gemini generateContent thất bại: ${lastError?.message || 'Lỗi không xác định'}`);
  }
}
