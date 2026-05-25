import axios from 'axios';
import { env } from '../utils/env';
import { cacheGet, cacheSet } from '../utils/redis';
import * as crypto from 'crypto';

let accessToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessToken.expiresAt) return accessToken.token;

  const res = await axios.post(
    `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${env.baiduOcrApiKey}&client_secret=${env.baiduOcrSecretKey}`
  );
  accessToken = {
    token: res.data.access_token as string,
    expiresAt: Date.now() + (res.data.expires_in as number) * 1000 - 60000,
  };
  return accessToken.token;
}

export async function recognizeText(imageBase64: string): Promise<string> {
  // 没有配置百度 OCR key 时，返回空字符串让上层给用户友好提示
  if (!env.baiduOcrApiKey || !env.baiduOcrSecretKey) {
    return '';
  }

  const cacheKey = `ocr:${crypto.createHash('md5').update(imageBase64.slice(0, 100)).digest('hex')}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached) return cached;

  const token = await getAccessToken();
  const res = await axios.post(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${token}`,
    `image=${encodeURIComponent(imageBase64)}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const words: string = res.data.words_result
    ? (res.data.words_result as Array<{ words: string }>).map((w) => w.words).join('\n')
    : '';

  if (words) await cacheSet(cacheKey, words, 3600);
  return words;
}
