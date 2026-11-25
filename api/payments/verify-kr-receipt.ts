import dns from 'dns';
import crypto from 'crypto';
import {
  analyzeKoreanBankReceiptWithGemini,
  createSignedPaidRedeemCode,
} from '../../src/server/krReceiptVerifier.ts';

dns.setDefaultResultOrder('ipv4first');

// Warm-instance anti-replay cache on serverless deployments
const seenReceiptHashes = new Set<string>();
const seenTransferFingerprints = new Set<string>();

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      verdict: 'មិនពិត',
      verdictBoolean: false,
      error: 'Method Not Allowed',
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const receiptImage = String(body?.receiptImage || '');
    const userEmail = String(body?.userEmail || 'guest@kiip-portal.kr').slice(0, 254);
    const lang = String(body?.lang || 'km').slice(0, 10);

    const commaIdx = receiptImage.indexOf(',');
    if (!receiptImage.startsWith('data:image/') || commaIdx === -1) {
      return res.status(400).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error:
          lang === 'ko'
            ? '이체 확인 스크린샷 이미지(PNG / JPG)를 업로드해 주세요.'
            : lang === 'en'
            ? 'Please upload a transfer receipt screenshot image (PNG / JPG).'
            : 'សូម Upload រូបភាព Screenshot វិក្កយបត្រផ្ទេរប្រាក់ (PNG / JPG)!',
      });
    }

    const meta = receiptImage.substring(0, commaIdx);
    const base64Data = receiptImage.substring(commaIdx + 1).replace(/\s/g, '');
    const mimeType = meta.split(';')[0]?.replace('data:', '') || 'image/jpeg';

    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)) {
      return res.status(400).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error:
          lang === 'ko'
            ? 'PNG, JPG 또는 WebP 이미지만 업로드할 수 있습니다.'
            : lang === 'en'
            ? 'Only PNG, JPG, or WebP screenshots are supported.'
            : 'គាំទ្រតែរូបភាព PNG, JPG ឬ WebP ប៉ុណ្ណោះ។',
      });
    }

    if (base64Data.length < 100 || base64Data.length > 14 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error:
          lang === 'ko'
            ? '이미지 크기가 올바르지 않습니다 (최대 10MB).'
            : lang === 'en'
            ? 'Invalid image size (maximum 10MB).'
            : 'ទំហំរូបភាពមិនត្រឹមត្រូវ (អតិបរមា 10MB)។',
      });
    }

    const imageSha256 = crypto
      .createHash('sha256')
      .update(Buffer.from(base64Data, 'base64'))
      .digest('hex');

    if (seenReceiptHashes.has(imageSha256)) {
      return res.status(409).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        duplicate: true,
        error:
          lang === 'ko'
            ? '이 이체 내역 스크린샷은 이미 리딤 코드 발급에 사용되었습니다.'
            : lang === 'en'
            ? 'This transfer receipt screenshot has already been used to issue a Redeem Code.'
            : 'រូបភាពវិក្កយបត្រផ្ទេរប្រាក់នេះត្រូវបានប្រើដើម្បីបញ្ចេញ Redeem Code រួចហើយ!',
      });
    }

    const analysis = await analyzeKoreanBankReceiptWithGemini(base64Data, mimeType, lang);
    if (!analysis.isValidReceipt) {
      return res.status(analysis.httpStatus || 422).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        error: analysis.reason,
        checks: analysis.checks,
        detected: {
          bankName: analysis.bankName,
          recipientName: analysis.recipientName,
          amountKrw: analysis.amountKrw,
          statusText: analysis.statusText,
          transferTimestamp: analysis.transferTimestamp,
        },
      });
    }

    if (analysis.transferFingerprint && seenTransferFingerprints.has(analysis.transferFingerprint)) {
      return res.status(409).json({
        success: false,
        verdict: 'មិនពិត',
        verdictBoolean: false,
        duplicate: true,
        checks: analysis.checks,
        error:
          lang === 'ko'
            ? '동일한 이체 내역이 이미 사용되었습니다.'
            : lang === 'en'
            ? 'This bank transfer has already been used to issue a Redeem Code.'
            : 'ប្រតិបត្តិការផ្ទេរប្រាក់នេះត្រូវបានប្រើដើម្បីបញ្ចេញ Redeem Code រួចហើយ!',
      });
    }

    seenReceiptHashes.add(imageSha256);
    if (analysis.transferFingerprint) {
      seenTransferFingerprints.add(analysis.transferFingerprint);
    }

    const unlockCode = createSignedPaidRedeemCode(`${imageSha256}:${userEmail}`);

    return res.status(200).json({
      success: true,
      verdict: 'ពិត',
      verdictBoolean: true,
      unlockCode,
      verifiedAmount: analysis.amountKrw,
      bankName: analysis.bankName,
      recipientName: analysis.recipientName,
      statusText: analysis.statusText,
      transferTimestamp: analysis.transferTimestamp,
      checks: analysis.checks,
    });
  } catch (err: any) {
    console.error('[Vercel KR Receipt] Verification failed:', err);
    return res.status(500).json({
      success: false,
      verdict: 'មិនពិត',
      verdictBoolean: false,
      error: 'Receipt verification encountered a server error. Please try again.',
    });
  }
}
