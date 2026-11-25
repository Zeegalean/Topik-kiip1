import React, { useState, useEffect } from 'react';
import { ApplicationFormData, Language } from '../types';
import { getTranslation } from '../utils/translations';
import { IMMIGRATION_OFFICES, findOfficeByAddress } from '../data/immigrationOffices';
import {
  Mail,
  Send,
  Copy,
  Check,
  Building2,
  Phone,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Paperclip,
  ExternalLink,
  Smartphone,
  Monitor,
  FileText,
  Info,
} from 'lucide-react';

interface Step4EmailSenderProps {
  formData: ApplicationFormData;
  lang: Language;
  onPrev: () => void;
  onRestart: () => void;
}

type GuideDeviceMode = 'both' | 'mobile' | 'desktop';

export const Step4EmailSender: React.FC<Step4EmailSenderProps> = ({
  formData,
  lang,
  onPrev,
  onRestart,
}) => {
  const t = getTranslation(lang);

  // Selected office
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('');
  const [customRecipientEmail, setCustomRecipientEmail] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [guideMode, setGuideMode] = useState<GuideDeviceMode>('both');
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSendingWebmasterEmail, setIsSendingWebmasterEmail] = useState(false);
  const [webmasterEmailNotice, setWebmasterEmailNotice] = useState<string | null>(null);

  const handleSendWebmasterEmail = async () => {
    setIsSendingWebmasterEmail(true);
    setWebmasterEmailNotice(null);
    try {
      const resp = await fetch('/api/mail/send-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: activeRecipientEmail,
          applicantName: applicantDisplayName,
          officeEmail: activeRecipientEmail,
          subject: emailSubject,
          body: emailBody,
        }),
      });
      const data = await resp.json();
      if (resp.ok && data?.success) {
        setWebmasterEmailNotice(
          isKm
            ? '✓ បានផ្ញើវិក្កយបត្រ ឯកសារ PDF និង Description ទៅកាន់អន្តោប្រវេសន៍តាមរយៈ Webmaster Email (Zoho SMTP) រួចរាល់!'
            : '✓ Receipt, PDF and description sent successfully via Webmaster Email!'
        );
      } else {
        setWebmasterEmailNotice(data?.error || 'Failed to send via webmaster email');
      }
    } catch (err: any) {
      setWebmasterEmailNotice('Error: ' + err.message);
    } finally {
      setIsSendingWebmasterEmail(false);
    }
  };

  // Auto-detect office based on address
  useEffect(() => {
    const matched = findOfficeByAddress(formData.address);
    if (matched) {
      setSelectedOfficeId(matched.id);
      setCustomRecipientEmail(matched.email);
      setSendError(null);
    } else {
      setSelectedOfficeId('');
    }
  }, [formData.address]);

  const handleSelectOffice = (id: string) => {
    setSelectedOfficeId(id);
    setSendError(null);
    const office = IMMIGRATION_OFFICES.find((o) => o.id === id);
    if (office) {
      setCustomRecipientEmail(office.email);
    }
  };

  const selectedOffice = IMMIGRATION_OFFICES.find((o) => o.id === selectedOfficeId) || null;
  const activeRecipientEmail = customRecipientEmail.trim() || selectedOffice?.email || '';

  const applicantDisplayName = formData.applicantName || formData.name || 'EANG VEASNA';
  const safeName = (formData.name || formData.applicantName || '신청인').replace(/[^a-zA-Z0-9가-힣]/g, '_');
  const expectedPdfFilename = `사회통합프로그램_연계신청서_통합서류_${safeName}.pdf`;

  // Build Subject
  const emailSubject = `사회통합프로그램(사회통합정보망) 연계 신청 서류 제출 - ${applicantDisplayName}`;

  // Build Body / Description
  const defaultEmailBody = `안녕하세요. ${applicantDisplayName}입니다.

사회통합프로그램(사회통합정보망) 연계 신청 서류를 새로 제출하였습니다.
바쁘시겠지만 확인 후 빠른 처리 부탁드립니다.

감사합니다.

[신청자 정보]
성명: ${applicantDisplayName}
연락처: ${formData.phone || formData.mobile || '010-0000-0000'}
Socinet ID: ${formData.socinetId || ''}
Socinet 비밀번호: ${formData.socinetPw || ''}

첨부: 통합 PDF (신청서, TOPIK 성적증명서, 외국인등록증, 여권)`;

  const [emailBody, setEmailBody] = useState<string>(defaultEmailBody);

  useEffect(() => {
    setEmailBody(defaultEmailBody);
  }, [
    formData.name,
    formData.applicantName,
    formData.phone,
    formData.mobile,
    formData.socinetId,
    formData.socinetPw,
  ]);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const fullCopyBundle = `받는 사람 (To): ${activeRecipientEmail || '(선택 필요)'}
제목 (Subject): ${emailSubject}

${emailBody}`;

  const handleOpenMailto = () => {
    if (!activeRecipientEmail) {
      setSendError(
        lang === 'km'
          ? 'សូមជ្រើសរើសការិយាល័យអន្តោប្រវេសន៍ ឬវាយបញ្ចូលអ៊ីមែលការិយាល័យជាមុនសិន!'
          : lang === 'ko'
          ? '출입국관서 이메일 주소를 입력하거나 선택해 주세요.'
          : 'Please select or enter the immigration office email address first.'
      );
      return;
    }
    setSendError(null);
    const mailtoUrl = `mailto:${activeRecipientEmail}?subject=${encodeURIComponent(
      emailSubject
    )}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoUrl;
  };

  const gmailComposeUrl = activeRecipientEmail
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
        activeRecipientEmail
      )}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(
        emailSubject
      )}&body=${encodeURIComponent(emailBody)}`;

  const isKm = lang === 'km';
  const isKo = lang === 'ko';

  const labels = {
    descriptionGuideTitle: isKm
      ? 'ការណែនាំអំពីខ្លឹមសារ Description ក្នុង Email (សរសេរជាភាសាកូរ៉េជូនមន្ត្រី)'
      : isKo
      ? '이메일 본문(Description) 구성 안내'
      : 'Email Description Breakdown',
    descriptionGuideItems: isKm
      ? [
          {
            key: 'សំណើសុំផ្លូវការ',
            desc: 'ពាក្យសួរសុខទុក្ខ និងបញ្ជាក់ថាបានដាក់ពាក្យសុំតភ្ជាប់ TOPIK → KIIP ថ្មី សូមមន្ត្រីជួយពិនិត្យនិងអនុម័ត។',
          },
          {
            key: 'ព័ត៌មានអ្នកស្នើសុំ',
            desc: 'ឈ្មោះពេញ, លេខទូរស័ព្ទទំនាក់ទំនង និងគណនី Socinet (ID និង Password) ដើម្បីឱ្យមន្ត្រីងាយស្រួលផ្ទៀងផ្ទាត់ និងបញ្ចូលកម្រិតជូន។',
          },
          {
            key: 'បញ្ជីឯកសារភ្ជាប់',
            desc: 'បញ្ជាក់ថាក្នុង File PDF តែមួយមាន៖ ពាក្យសុំផ្លូវការ + TOPIK + កាត ARC + លិខិតឆ្លងដែន។',
          },
        ]
      : isKo
      ? [
          {
            key: '신청 인사말',
            desc: '사회통합프로그램(KIIP) 연계 신청 서류 제출 안내 및 확인 요청 문구입니다.',
          },
          {
            key: '신청자 및 Socinet 계정',
            desc: '성명, 연락처, Socinet ID 및 비밀번호를 포함하여 담당자가 바로 연계 처리를 진행할 수 있습니다.',
          },
          {
            key: '첨부 서류 목록',
            desc: '통합 PDF 1개 파일에 신청서, TOPIK 성적증명서, 외국인등록증, 여권이 모두 포함되어 있음을 안내합니다.',
          },
        ]
      : [
          {
            key: 'Formal Request',
            desc: 'Polite Korean greeting requesting linkage processing from TOPIK to KIIP.',
          },
          {
            key: 'Applicant & Socinet Info',
            desc: 'Includes full name, phone number, Socinet ID, and password so officers can verify and assign your level.',
          },
          {
            key: 'Attachment Note',
            desc: 'Lists the 4 documents bundled in your single merged PDF file.',
          },
        ],
    guideSectionTitle: isKm
      ? 'ការណែនាំលម្អិត របៀបផ្ញើ File PDF និង Description ទៅការិយាល័យអន្តោប្រវេសន៍'
      : isKo
      ? '출입국관서로 PDF 파일 및 이메일 본문 전송 방법 (모바일 · PC 안내)'
      : 'Step-by-Step Guide: Sending Your PDF & Email Description (Mobile & PC)',
    guideSectionSubtitle: isKm
      ? 'សូមអនុវត្តតាមជំហានខាងក្រោមឱ្យបានត្រឹមត្រូវ ដើម្បីប្រាកដថា File PDF និងខ្លឹមសារ Description ត្រូវបានភ្ជាប់ផ្ញើទៅមន្ត្រីដោយជោគជ័យ'
      : isKo
      ? '모바일과 컴퓨터 환경에 맞춰 아래 순서대로 PDF 파일 첨부 및 메일 본문 전송을 진행해 주세요.'
      : 'Follow the instructions below for your smartphone or computer to ensure both your PDF file and description are delivered properly.',
    tabBoth: isKm ? 'មើលទាំងពីរ (ទូរស័ព្ទ & កុំព្យូទ័រ)' : isKo ? '모바일 · PC 모두 보기' : 'Both (Mobile & PC)',
    tabMobile: isKm ? 'តាមទូរស័ព្ទដៃ (Mobile)' : isKo ? '모바일 (스마트폰)' : 'Mobile Phone',
    tabDesktop: isKm ? 'តាមកុំព្យូទ័រ (PC / Mac)' : isKo ? '컴퓨터 (PC / Mac)' : 'Computer (PC / Mac)',
    mobileTitle: isKm
      ? 'វិធីផ្ញើតាមទូរស័ព្ទដៃ (Android & iPhone)'
      : isKo
      ? '모바일(스마트폰)으로 PDF 및 내용 보내기'
      : 'How to Send on Mobile Phone (Android & iPhone)',
    mobileSubtitle: isKm
      ? 'សម្រាប់អ្នកប្រើប្រាស់កម្មវិធី Gmail, Naver Mail, ឬ Apple Mail លើទូរស័ព្ទ'
      : isKo
      ? 'Gmail, 네이버 메일, 아이폰 Mail 앱 사용 기준'
      : 'For Gmail, Naver Mail, or Apple Mail apps',
    mobileSteps: isKm
      ? [
          {
            num: '01',
            title: 'ទាញយក File PDF ទុកក្នុងទូរស័ព្ទជាមុនសិន',
            detail:
              'ប្រសិនបើមិនទាន់ទាញយកទេ សូមចុចត្រឡប់ទៅជំហ៊ានទី ៤ រួចទាញយកឯកសារ PDF Merge។ លើ iPhone សូមចុច Save to Files (រក្សាទុកក្នុង Downloads) ហើយលើ Android File នឹងចូលក្នុងថត Downloads / My Files ដោយស្វ័យប្រវត្តិ។',
          },
          {
            num: '02',
            title: 'ចម្លង (Copy) អ៊ីមែល ចំណងជើង និងខ្លឹមសារ Description',
            detail:
              'ចុចប៊ូតុង "Copy" លើអាសយដ្ឋានអ៊ីមែលការិយាល័យ (받는 사람), ចំណងជើង (제목), និងខ្លឹមសារ Description (내용) ខាងលើ ឬចុចប៊ូតុង "បើកកម្មវិធី Email" ដើម្បីឱ្យទូរស័ព្ទបំពេញអក្សរទាំងអស់ចូល Mail App ដោយស្វ័យប្រវត្តិ។',
          },
          {
            num: '03',
            title: 'បើកកម្មវិធី Email និងចុចភ្ជាប់ File PDF (📎 Attach)',
            detail:
              'បើកកម្មវិធី Gmail / Naver Mail / Apple Mail → ចុច Compose (សរសេរថ្មី) ហើយ Paste អក្សរដែលបាន Copy។ បន្ទាប់មកចុចរូប "ម្ជុលខ្ទាស់ 📎" (Attach file / 파일 첨부) → ជ្រើសរើស Files / Browse → បើកថត Downloads → ចុចលើ File PDF ឈ្មោះ "사회통합프로그램_연계신청서_통합서류_..."។',
          },
          {
            num: '04',
            title: 'ពិនិត្យ File PDF និងចុចផ្ញើ (Send / 보내기)',
            detail:
              'ត្រូវប្រាកដថាឃើញឈ្មោះ File PDF និងទំហំ File ជាប់នៅខាងក្រោមខ្លឹមសារ Description រួចសឹមចុចប៊ូតុង Send (✈️ / 보내기)។',
          },
        ]
      : isKo
      ? [
          {
            num: '01',
            title: '스마트폰에 통합 PDF 파일 저장 확인',
            detail:
              '4단계에서 통합 PDF를 먼저 다운로드하세요. 아이폰(Safari)은 "파일에 저장(Downloads)"을 누르고, 안드로이드(Chrome)는 "내 파일 > 다운로드(Downloads)" 폴더에 자동 저장됩니다.',
          },
          {
            num: '02',
            title: '이메일 주소·제목·본문(Description) 복사 또는 메일 앱 열기',
            detail:
              '위의 "1-Click 이메일 앱 열기" 또는 "Gmail 웹으로 열기"를 누르거나, 받는 사람 이메일·제목·본문 복사 버튼을 눌러 메일 작성 화면에 붙여넣으세요.',
          },
          {
            num: '03',
            title: '클립 아이콘(📎 파일 첨부)을 눌러 PDF 첨부하기',
            detail:
              '메일 앱 상단 또는 하단의 클립(📎) 아이콘을 누르고 "파일 첨부 / 파일 선택"에서 다운로드(Downloads) 폴더의 "사회통합프로그램_연계신청서_통합서류_..." PDF 파일을 선택하세요.',
          },
          {
            num: '04',
            title: '첨부 확인 후 전송(보내기) 누르기',
            detail:
              '메일 본문 아래에 PDF 파일이 정상 첨부되었는지 확인한 뒤 보내기(Send) 버튼을 눌러 제출을 완료하세요.',
          },
        ]
      : [
          {
            num: '01',
            title: 'Confirm the merged PDF is saved on your phone',
            detail:
              'Download the merged PDF in Step 4. On iPhone Safari, tap Save to Files (Downloads). On Android Chrome, it saves automatically to Downloads / My Files.',
          },
          {
            num: '02',
            title: 'Copy recipient email, subject, and description',
            detail:
              'Use the Copy buttons above or tap Open Email App / Open Gmail Web to pre-fill the recipient email, subject, and Korean description.',
          },
          {
            num: '03',
            title: 'Tap the Paperclip (📎 Attach) icon and select the PDF',
            detail:
              'In Gmail, Naver Mail, or Apple Mail, tap the 📎 Attach icon → Browse / Files → Downloads → select "사회통합프로그램_연계신청서_통합서류_...".pdf.',
          },
          {
            num: '04',
            title: 'Verify attachment & tap Send',
            detail:
              'Make sure the PDF file appears below the message description before tapping Send.',
          },
        ],
    mobileTip: isKm
      ? 'ចំណាំសម្រាប់ទូរស័ព្ទ៖ ប៊ូតុង "បើកកម្មវិធី Email" មិនអាចទាញ File PDF ភ្ជាប់ដោយស្វ័យប្រវត្តិបានទេ (ដោយសារប្រព័ន្ធសុវត្ថិភាពរបស់ទូរស័ព្ទ) ដូច្នេះអ្នកត្រូវចុចរូប 📎 Attach រើស File PDF ដោយផ្ទាល់ជានិច្ច។'
      : isKo
      ? '모바일 참고: 보안 정책상 메일 앱 자동 실행 시 PDF 파일이 자동 첨부되지 않으므로, 반드시 📎 파일 첨부 아이콘을 눌러 직접 PDF를 선택해 주세요.'
      : 'Mobile Note: Mobile security prevents apps from auto-attaching local files. Always tap the 📎 Attach icon manually to add your PDF.',
    desktopTitle: isKm
      ? 'វិធីផ្ញើតាមកុំព្យូទ័រ (PC / Laptop / Mac)'
      : isKo
      ? '컴퓨터(PC / Mac)로 PDF 및 내용 보내기'
      : 'How to Send on Computer (PC / Mac)',
    desktopSubtitle: isKm
      ? 'សម្រាប់អ្នកប្រើប្រាស់លើ Browser (Gmail, Naver Mail, Daum) ឬកម្មវិធី Mail លើកុំព្យូទ័រ'
      : isKo
      ? 'Chrome·Edge 브라우저(Gmail, 네이버·다음 메일) 또는 PC 메일 기준'
      : 'For Gmail, Naver Mail, Daum Mail, or Desktop Mail clients',
    desktopSteps: isKm
      ? [
          {
            num: '01',
            title: 'ពិនិត្យទីតាំង File PDF ក្នុងថត Downloads',
            detail:
              'នៅជំហ៊ានទី ៤ ក្រោយពេលចុចទាញយក File PDF ឈ្មោះ "사회통합프로그램_연계신청서_통합서류_..." នឹងស្ថិតនៅក្នុងថត Downloads នៃកុំព្យូទ័រ។ អ្នកអាចចុច Ctrl + J (Windows) ឬ Cmd + Shift + J (Mac) ដើម្បីបើកមើលទីតាំង File។',
          },
          {
            num: '02',
            title: 'បើក Gmail លើ Web ឬគេហទំព័រអ៊ីមែលរបស់អ្នក',
            detail:
              'ចុចប៊ូតុង "បើក Gmail លើ Web" ខាងក្រោមដើម្បីបំពេញអ៊ីមែលការិយាល័យ ចំណងជើង និងខ្លឹមសារ Description ជាស្រេច ឬបើក Naver Mail (mail.naver.com) / Daum Mail ហើយចុច 메일쓰기 (Compose) រួច Copy-Paste ព័ត៌មានពីផ្នែកខាងលើ។',
          },
          {
            num: '03',
            title: 'ភ្ជាប់ File PDF (ចុច 📎 Attach ឬអូសទម្លាក់ Drag & Drop)',
            detail:
              'នៅក្នុងផ្ទាំងសរសេរអ៊ីមែល ចុចរូប "ម្ជុលខ្ទាស់ 📎" (Attach files / 내 PC) រួចចូលថត Downloads ដើម្បីរើសយក File PDF ឬអាចអូស File PDF ពីថត Downloads ទម្លាក់ចូលប្រអប់សរសេរអ៊ីមែលដោយផ្ទាល់។',
          },
          {
            num: '04',
            title: 'រង់ចាំ Upload ពេញ ១០០% រួចចុច Send (보내기)',
            detail:
              'រង់ចាំឱ្យឈ្មោះ File PDF លោតពេញលេញ ពិនិត្យលេខទូរស័ព្ទ និង Socinet ID/PW ក្នុងខ្លឹមសារ Description ឱ្យត្រឹមត្រូវ រួចចុច Send (보내기)។',
          },
        ]
      : isKo
      ? [
          {
            num: '01',
            title: 'PC 다운로드(Downloads) 폴더에서 PDF 파일 확인',
            detail:
              '4단계에서 다운로드한 "사회통합프로그램_연계신청서_통합서류_..." PDF 파일이 컴퓨터의 다운로드 폴더에 저장되어 있습니다. 브라우저에서 Ctrl+J(Mac은 Cmd+Shift+J)로 바로 확인할 수 있습니다.',
          },
          {
            num: '02',
            title: 'Gmail 웹 열기 또는 네이버·다음 메일 쓰기 실행',
            detail:
              '위의 "Gmail 웹으로 열기" 버튼을 누르면 받는 사람·제목·본문이 자동 입력됩니다. 네이버/다음 메일을 쓰시는 경우 복사 버튼을 눌러 받는사람(To)·제목·본문에 각각 붙여넣으세요.',
          },
          {
            num: '03',
            title: '파일 첨부(📎 내 PC) 또는 마우스로 드래그하여 첨부',
            detail:
              '메일 쓰기 화면의 클립(📎 파일 첨부 / 내 PC) 버튼을 눌러 다운로드 폴더의 PDF 파일을 선택하거나, 다운로드 창에서 PDF 파일을 메일 본문 위로 드래그(Drag & Drop)하세요.',
          },
          {
            num: '04',
            title: '업로드 100% 완료 확인 후 보내기(Send)',
            detail:
              'PDF 파일 업로드 게이지가 100% 완료되고 신청자 성명, 연락처, Socinet ID/비밀번호가 맞는지 확인한 뒤 보내기(Send)를 누르세요.',
          },
        ]
      : [
          {
            num: '01',
            title: 'Locate the downloaded PDF in your Downloads folder',
            detail:
              'Your merged PDF from Step 4 is saved in your computer Downloads folder. Press Ctrl+J (Windows) or Cmd+Shift+J (Mac) in Chrome/Edge to view it.',
          },
          {
            num: '02',
            title: 'Open Gmail Web or your preferred email provider',
            detail:
              'Click "Open Gmail on Web" to auto-fill recipient, subject, and description, or open Naver/Daum/Outlook and copy-paste each field from above.',
          },
          {
            num: '03',
            title: 'Attach the PDF (Click 📎 Attach or Drag & Drop)',
            detail:
              'Click the 📎 Attach files button and select the PDF from Downloads, or drag and drop the PDF file directly into the compose window.',
          },
          {
            num: '04',
            title: 'Wait for upload completion and click Send',
            detail:
              'Confirm the PDF upload finishes 100% and verify your contact info and Socinet ID/PW in the description before clicking Send.',
          },
        ],
    desktopTip: isKm
      ? 'ចំណាំសម្រាប់កុំព្យូទ័រ៖ បើប្រើ Gmail លើ Browser Chrome/Edge សូមចុចប៊ូតុង "បើក Gmail លើ Web" ដើម្បីងាយស្រួលបំផុត (វាបំពេញអ៊ីមែល ចំណងជើង និង Description ឱ្យស្រេច នៅសល់តែទាញ File PDF ចូលប៉ុណ្ណោះ)។'
      : isKo
      ? 'PC 팁: 크롬·엣지 브라우저에서 Gmail을 사용 중이라면 위의 "Gmail 웹으로 열기" 버튼이 가장 간편합니다. 본문이 자동 입력되므로 PDF 파일만 끌어다 놓으면 됩니다.'
      : 'PC Tip: Using "Open Gmail on Web" pre-fills To, Subject, and Description in one click—you only need to attach the PDF file.',
    afterSendTitle: isKm
      ? 'ការផ្ទៀងផ្ទាត់បន្ទាប់ពីចុចផ្ញើ (ក្រោយពេល Send រួច)'
      : isKo
      ? '이메일 발송 후 확인 사항'
      : 'After Sending Checklist',
    afterSendItems: isKm
      ? [
          'ចូលមើលក្នុងប្រអប់ Sent (អ៊ីមែលដែលបានផ្ញើ) ដើម្បីប្រាកដថា File PDF ពិតជាបានភ្ជាប់ទៅជាមួយអ៊ីមែលមែន។',
          'ប្រើអាសយដ្ឋានអ៊ីមែលផ្ទាល់ខ្លួនរបស់អ្នក ដើម្បីទទួលសារឆ្លើយតប ឬសំណើបំពេញបន្ថែមពីមន្ត្រីអន្តោប្រវេសន៍។',
          'ជាទូទៅមន្ត្រីពិនិត្យ និងបញ្ចូលកម្រិត KIIP ជូនក្នុងរយៈពេល ១–៥ ថ្ងៃធ្វើការ (អាចចូលពិនិត្យលើគេហទំព័រ www.socinet.go.kr)។',
        ]
      : isKo
      ? [
          '보낸메일함(Sent)에서 PDF 파일이 정상 첨부되어 발송되었는지 한 번 더 확인하세요.',
          '담당자의 회신이나 보완 요청을 받을 수 있도록 본인 명의의 사용 중인 이메일로 발송하세요.',
          '접수 후 보통 영업일 기준 1~5일 내에 처리되며, 사회통합정보망(www.socinet.go.kr) 마이페이지에서 배정 단계를 확인할 수 있습니다.',
        ]
      : [
          'Check your Sent folder to verify the PDF file is attached to the sent email.',
          'Send from your active personal email so you receive any follow-up reply from the immigration officer.',
          'Processing usually takes 1–5 business days; check your KIIP stage status at www.socinet.go.kr.',
        ],
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Top Banner */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-2 mb-2 text-xs font-bold text-rose-700">
          <span>{t.step4Tab}</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
          {t.step4Title}
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          {t.step4Subtitle}
        </p>

        {/* Address and Jurisdiction status */}
        <div className="mt-5 p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-bold text-slate-500 uppercase tracking-wider text-[11px] block">
              {t.residenceAddress}
            </span>
            <span className="font-bold text-slate-900 text-sm mt-0.5 block">
              {formData.address || '(미입력)'}
            </span>
          </div>

          {selectedOffice ? (
            <div className="flex items-center gap-2 text-emerald-800 bg-emerald-100/70 px-3 py-1.5 rounded-xl font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>관할 관서: {selectedOffice.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-800 bg-amber-100/70 px-3 py-1.5 rounded-xl font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{t.notMatchedWarning}</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Email Form Section */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-6 sm:p-8 space-y-6">
          {/* Office Select Dropdown & Manual Input */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <span>받는 사람 (출입국관서 이메일)</span>
                <span className="text-rose-500">*</span>
                <span className="text-[11px] font-normal text-slate-500">{t.manualSelectOrEdit}</span>
              </label>
              {selectedOffice && (
                <span className="text-blue-600 text-xs font-semibold tabular-nums">
                  전화: {selectedOffice.phone}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Dropdown selector */}
              <div>
                <select
                  value={selectedOfficeId}
                  onChange={(e) => handleSelectOffice(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 font-semibold text-xs sm:text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs cursor-pointer"
                >
                  <option value="">{t.selectOffice}</option>
                  {IMMIGRATION_OFFICES.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name} ({office.email})
                    </option>
                  ))}
                </select>
              </div>

              {/* Manual Direct Editable Input */}
              <div className="relative">
                <input
                  type="email"
                  placeholder={
                    isKm
                      ? 'kiipdaejeon@korea.kr (កែដោយដៃ)'
                      : isKo
                      ? 'kiipdaejeon@korea.kr (직접 입력)'
                      : 'kiipdaejeon@korea.kr (custom edit)'
                  }
                  value={customRecipientEmail}
                  onChange={(e) => {
                    setCustomRecipientEmail(e.target.value);
                    setSendError(null);
                  }}
                  className="w-full pl-4 pr-24 py-3 rounded-xl border border-slate-300 font-bold text-sm bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(activeRecipientEmail, 'email')}
                  disabled={!activeRecipientEmail}
                  className="absolute right-2 top-2 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {copiedField === 'email' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Selected Office Details Card */}
            {selectedOffice && (
              <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-blue-700" />
                    <span>{selectedOffice.name} (이민통합지원센터)</span>
                  </div>
                  <div className="text-slate-600 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>{selectedOffice.address}</span>
                  </div>
                  <div className="text-slate-600 flex items-center gap-1.5 tabular-nums">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      전용 전화: <strong>{selectedOffice.phone}</strong>
                    </span>
                  </div>
                </div>

                <div className="text-blue-800 font-semibold text-[11px]">
                  관할 관서 자동 선택됨
                </div>
              </div>
            )}
          </div>

          {/* Email Subject */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                {t.emailSubject}
              </label>
              <button
                type="button"
                onClick={() => copyToClipboard(emailSubject, 'subject')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
              >
                {copiedField === 'subject' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{t.copied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t.copySubjectBtn}</span>
                  </>
                )}
              </button>
            </div>
            <input
              type="text"
              readOnly
              value={emailSubject}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-bold text-sm text-slate-900 select-all"
            />
          </div>

          {/* Email Content / Description */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                {t.emailContent} / Description
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => copyToClipboard(fullCopyBundle, 'all')}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-950 flex items-center gap-1 cursor-pointer"
                >
                  {copiedField === 'all' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>
                        {isKm ? 'ចម្លងទាំងអស់' : isKo ? '전체 정보 복사' : 'Copy All Fields'}
                      </span>
                    </>
                  )}
                </button>
                <span className="text-slate-300" aria-hidden="true">
                  |
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(emailBody, 'body')}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                >
                  {copiedField === 'body' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{t.copyBodyBtn}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <textarea
              rows={13}
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              className="w-full p-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 font-mono text-xs sm:text-sm text-slate-900 leading-relaxed outline-none transition-colors"
              title="អាចកែប្រែខ្លឹមសារ Email ដោយដៃបាន"
            />

            {/* Clear Explanation of Email Description */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{labels.descriptionGuideTitle}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {labels.descriptionGuideItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="text-xs text-slate-600 leading-relaxed border-t border-slate-200 pt-2 md:border-t-0 md:pt-0 md:border-r md:last:border-r-0 md:pr-3"
                  >
                    <p className="font-bold text-slate-900 mb-0.5">
                      {idx + 1}. {item.key}
                    </p>
                    <p>{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {sendError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{sendError}</span>
            </div>
          )}

          {/* Action Buttons: 1-Click Open Email App & Open Gmail Web & Webmaster Auto-Send */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={handleOpenMailto}
              disabled={!activeRecipientEmail}
              className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white font-extrabold text-sm shadow-lg shadow-indigo-900/15 flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.openEmailClientBtn}</span>
            </button>

            <a
              href={gmailComposeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-sm shadow-md flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01]"
            >
              <Mail className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="truncate">
                {isKm
                  ? 'បើក Gmail លើ Web (PC / Browser)'
                  : isKo
                  ? 'Gmail 웹에서 바로 작성하기 (PC 추천)'
                  : 'Open Gmail on Web (PC / Browser)'}
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </a>

            <button
              type="button"
              onClick={handleSendWebmasterEmail}
              disabled={isSendingWebmasterEmail || !activeRecipientEmail}
              className="w-full sm:col-span-2 py-3.5 px-5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white font-extrabold text-sm shadow-lg flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Mail className="w-4 h-4 text-amber-300 shrink-0" />
              <span>
                {isKm
                  ? '🤖 ផ្ញើស្វ័យប្រវត្តិតាមរយៈ Webmaster / Zoho Email (Auto-Send)'
                  : 'Auto-Send via Webmaster Email (Zoho SMTP)'}
              </span>
            </button>

            {webmasterEmailNotice && (
              <div className="sm:col-span-2 p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs font-bold text-center">
                {webmasterEmailNotice}
              </div>
            )}
          </div>

          {/* Critical Reminder Box with Exact Filename Copy */}
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
            <Paperclip className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1.5 flex-1">
              <p className="font-bold text-amber-900">{t.attachReminderTitle}</p>
              <p className="text-amber-800 leading-relaxed">{t.attachReminderDesc}</p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <span className="text-amber-900 text-[11px] font-semibold">
                  {isKm ? 'ឈ្មោះ File PDF ត្រូវភ្ជាប់៖ ' : isKo ? '첨부할 PDF 파일명: ' : 'PDF File to Attach: '}
                  <strong className="font-mono break-all">{expectedPdfFilename}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(expectedPdfFilename, 'filename')}
                  className="px-2 py-0.5 rounded bg-amber-200/70 hover:bg-amber-200 text-amber-950 font-bold text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer"
                >
                  {copiedField === 'filename' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-700" />
                      <span>{t.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clear Step-by-Step Guide for Mobile & Computer */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="space-y-1 max-w-2xl">
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-600 shrink-0" />
              <span>{labels.guideSectionTitle}</span>
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {labels.guideSectionSubtitle}
            </p>
          </div>

          {/* Interactive Device Filter Tabs */}
          <div className="flex flex-wrap sm:inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start lg:self-auto shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setGuideMode('both')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                guideMode === 'both'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {labels.tabBoth}
            </button>
            <button
              type="button"
              onClick={() => setGuideMode('mobile')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                guideMode === 'mobile'
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{labels.tabMobile}</span>
            </button>
            <button
              type="button"
              onClick={() => setGuideMode('desktop')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                guideMode === 'desktop'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>{labels.tabDesktop}</span>
            </button>
          </div>
        </div>

        {/* Guide Columns: Mobile & Desktop */}
        <div
          className={`grid gap-6 ${
            guideMode === 'both' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {/* Mobile Phone Instructions */}
          {(guideMode === 'both' || guideMode === 'mobile') && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 sm:p-6 space-y-4">
              <div className="flex items-start gap-3 border-b border-blue-200/70 pb-4">
                <div className="p-2.5 rounded-xl bg-blue-600 text-white shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">{labels.mobileTitle}</h4>
                  <p className="text-xs text-slate-600 mt-0.5">{labels.mobileSubtitle}</p>
                </div>
              </div>

              <ol className="space-y-4">
                {labels.mobileSteps.map((step) => (
                  <li key={step.num} className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 font-mono font-bold text-xs flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                      {step.num}
                    </span>
                    <div className="space-y-1 text-xs sm:text-[13px]">
                      <p className="font-bold text-slate-900">{step.title}</p>
                      <p className="text-slate-600 leading-relaxed">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="pt-3 border-t border-blue-200/70 text-xs text-blue-900 leading-relaxed">
                {labels.mobileTip}
              </div>
            </div>
          )}

          {/* Computer / PC Instructions */}
          {(guideMode === 'both' || guideMode === 'desktop') && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 sm:p-6 space-y-4">
              <div className="flex items-start gap-3 border-b border-emerald-200/70 pb-4">
                <div className="p-2.5 rounded-xl bg-emerald-600 text-white shrink-0">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">{labels.desktopTitle}</h4>
                  <p className="text-xs text-slate-600 mt-0.5">{labels.desktopSubtitle}</p>
                </div>
              </div>

              <ol className="space-y-4">
                {labels.desktopSteps.map((step) => (
                  <li key={step.num} className="flex items-start gap-3">
                    <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 font-mono font-bold text-xs flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                      {step.num}
                    </span>
                    <div className="space-y-1 text-xs sm:text-[13px]">
                      <p className="font-bold text-slate-900">{step.title}</p>
                      <p className="text-slate-600 leading-relaxed">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="pt-3 border-t border-emerald-200/70 text-xs text-emerald-900 leading-relaxed">
                {labels.desktopTip}
              </div>
            </div>
          )}
        </div>

        {/* Post-send Checklist */}
        <div className="border-t border-slate-200 pt-5 space-y-2.5">
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{labels.afterSendTitle}</span>
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600 leading-relaxed">
            {labels.afterSendItems.map((item, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 md:border-r md:last:border-r-0 md:border-slate-200 md:pr-3"
              >
                <span className="font-mono font-bold text-slate-400 tabular-nums">
                  0{idx + 1}.
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Nav footer */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <button
          type="button"
          onClick={onPrev}
          className="px-6 py-3 rounded-xl border border-slate-300 font-bold text-slate-700 text-sm hover:bg-slate-100 transition-colors cursor-pointer"
        >
          {t.prevStep}
        </button>

        <button
          type="button"
          onClick={onRestart}
          className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-sm transition-colors shadow-xs cursor-pointer"
        >
          {t.newApplication}
        </button>
      </div>
    </div>
  );
};
