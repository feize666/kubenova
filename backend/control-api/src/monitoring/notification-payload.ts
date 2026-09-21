import { BadRequestException } from '@nestjs/common';

export function renderNotificationPayload(template: string, values: { title: string; message: string }): string {
  const invalid = () => new BadRequestException('通知正文必须是有效的 JSON 对象，变量仅支持 title 和 message');
  if (typeof template !== 'string' || Buffer.byteLength(template) > 65536 ||
    Object.values(values).some(value => typeof value !== 'string' || Buffer.byteLength(value) > 65536)) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(template); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
  let expandedBytes = Buffer.byteLength(template);
  const render = (value: unknown, depth: number): unknown => {
    if (depth > 32) throw invalid();
    if (typeof value === 'string') {
      return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => {
        const key = name.trim();
        if (key !== 'title' && key !== 'message') throw invalid();
        expandedBytes += Buffer.byteLength(values[key]);
        if (expandedBytes > 262144) throw invalid();
        return values[key];
      });
    }
    if (Array.isArray(value)) return value.map(item => render(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (key.includes('{{')) throw invalid();
        return [key, render(item, depth + 1)];
      }));
    }
    return value;
  };
  const output = JSON.stringify(render(parsed, 0));
  if (Buffer.byteLength(output) > 262144) throw invalid();
  return output;
}
