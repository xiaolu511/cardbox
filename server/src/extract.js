import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { extname } from 'node:path';

// 把用户丢进来的文件变成纯文本。支持 txt / md / docx / pdf。
// 不做 OCR：扫描版 PDF 里没有文字层，这里只会返回空串，调用方要提示用户。
export async function extractText(buffer, filename = '') {
  const ext = extname(filename).toLowerCase();

  if (ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '') {
    return buffer.toString('utf8');
  }

  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      await parser.destroy?.();
    }
  }

  throw new Error('不支持的文件类型：' + (ext || filename));
}
