import { getKoreaBankPaymentInfo } from '../../src/server/krReceiptVerifier.ts';

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }
  const krBank = getKoreaBankPaymentInfo();
  return res.status(200).json({
    success: true,
    bankName: krBank.bankName,
    accountNumber: krBank.accountNumber,
    accountHolder: krBank.accountHolder,
    telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    amountKrw: 35000,
    autoReceiptVerifyEnabled: Boolean(process.env.GEMINI_API_KEY),
    telegramBotEnabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
}
