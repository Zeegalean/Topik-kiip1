import { verifySignedPaidRedeemCode } from '../../src/server/krReceiptVerifier.ts';

const burnedServerlessCodes = new Set<string>();

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, valid: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const code = String(body?.code || '').trim().toUpperCase();
    const applicantName = String(body?.applicantName || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
    const lang = String(body?.lang || 'km').slice(0, 10);

    if (!code || code.length < 4) {
      return res.status(400).json({
        success: false,
        valid: false,
        error:
          lang === 'ko'
            ? '코드를 입력해 주세요.'
            : lang === 'en'
            ? 'Please enter a valid code.'
            : 'សូមបញ្ចូលលេខកូដជាមុនសិន។',
      });
    }

    if (burnedServerlessCodes.has(code)) {
      return res.status(400).json({
        success: false,
        valid: false,
        error:
          lang === 'ko'
            ? '이미 사용된 리딤 코드입니다.'
            : lang === 'en'
            ? 'This Redeem Code has already been used.'
            : 'លេខកូដ Redeem នេះត្រូវបានប្រើរួចហើយ!',
      });
    }

    if (verifySignedPaidRedeemCode(code)) {
      burnedServerlessCodes.add(code);
      return res.status(200).json({
        success: true,
        valid: true,
        source: 'kr_receipt',
        code,
        idCardName: applicantName,
        message: 'Verified & unlocked',
      });
    }

    return res.status(400).json({
      success: false,
      valid: false,
      error:
        lang === 'ko'
          ? '유효하지 않거나 이미 사용된 코드입니다. 코드를 다시 확인해 주세요.'
          : lang === 'en'
          ? 'Invalid, unpaid, or already used code. Please verify and try again.'
          : 'លេខកូដមិនត្រឹមត្រូវ មិនទាន់បង់ប្រាក់ ឬប្រើរួចហើយ។ សូមពិនិត្យម្តងទៀត!',
    });
  } catch (err: any) {
    console.error('[Vercel verify-redeem] Error:', err);
    return res.status(500).json({
      success: false,
      valid: false,
      error: 'Could not verify code at this time.',
    });
  }
}
