import React, { useState } from 'react';
import { ChevronDown, BookOpen, ArrowRight, CheckCircle2, HelpCircle } from 'lucide-react';
import { Language } from '../types';

interface SeoGuideFooterSectionProps {
  lang: Language;
  onStartNow: () => void;
}

const CONVERSION_ROWS = [
  { topik: 'TOPIK 1급 (Level 1)', kiip: 'KIIP 2단계 (Stage 2)', noteKm: 'រំលងកម្រិត ០ និង ១ (ចំណេញ ១១៥ ម៉ោង)', noteKo: '0·1단계 면제 (초급2 배정)', noteEn: 'Skips Stage 0 & 1' },
  { topik: 'TOPIK 2급 (Level 2)', kiip: 'KIIP 3단계 (Stage 3)', noteKm: 'រំលងកម្រិត ០–២ (ចំណេញ ២១៥ ម៉ោង)', noteKo: '0~2단계 면제 (중급1 배정)', noteEn: 'Skips Stages 0–2' },
  { topik: 'TOPIK 3급 (Level 3)', kiip: 'KIIP 4단계 (Stage 4)', noteKm: 'រំលងកម្រិត ០–៣ (ចំណេញ ៣១៥ ម៉ោង)', noteKo: '0~3단계 면제 (중급2 배정)', noteEn: 'Skips Stages 0–3' },
  { topik: 'TOPIK 4급 (Level 4)', kiip: 'KIIP 5단계 기본 (Stage 5 Basic)', noteKm: 'រំលងកម្រិត ០–៤ (រៀនតែ ៧០ ម៉ោង)', noteKo: '0~4단계 면제 (5단계 기본 배정)', noteEn: 'Skips Stages 0–4' },
  { topik: 'TOPIK 5급 · 6급 (Level 5–6)', kiip: 'KIIP 5단계 심화 / ការប្រឡងបញ្ចប់', noteKm: 'ពិន្ទុអាទិភាពខ្ពស់បំផុត E-7-4 / F-2', noteKo: '5단계 영주·귀화 심화 연계', noteEn: 'Highest Stage 5 Placement' },
];

export const SeoGuideFooterSection: React.FC<SeoGuideFooterSectionProps> = ({ lang, onStartNow }) => {
  const isKm = lang === 'km';
  const isKo = lang === 'ko';
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  const faqs = isKo
    ? [
        {
          q: 'TOPIK 성적을 KIIP 사회통합프로그램으로 연계 신청하려면 어떤 서류가 필요한가요?',
          a: '외국인등록증(ARC 앞·뒷면), 유효한 TOPIK 성적증명서(문서확인번호 16자리 포함), 여권 사본, 소시넷(Socinet) 아이디, 그리고 사회통합프로그램 연계 신청서[서식 제1호]가 필요합니다.',
        },
        {
          q: 'TOPIK 급수별 KIIP 배정 단계는 어떻게 되나요?',
          a: 'TOPIK 1급→KIIP 2단계, 2급→3단계, 3급→4단계, 4~6급→5단계로 사전평가 없이 바로 연계 배정됩니다.',
        },
        {
          q: '완성된 연계 신청서 PDF는 어디로 제출하나요?',
          a: '체류지(ARC 주소) 관할 출입국·외국인청 사회통합프로그램 담당 이메일로 PDF 통합본을 발송하시면 됩니다. 본 포털 5단계에서 관할 이메일을 자동 매칭해 드립니다.',
        },
      ]
    : isKm
    ? [
        {
          q: 'តើការប្តូរ TOPIK to KIIP (ផ្ទេរពិន្ទុ TOPIK ទៅ KIIP) ត្រូវការឯកសារអ្វីខ្លះ?',
          a: 'ត្រូវការ៖ ១) កាតស្នាក់នៅ ARC (មុខ-ក្រោយ), ២) សញ្ញាបត្រពិន្ទុ TOPIK ដែលមានលេខផ្ទៀងផ្ទាត់ ១៦ខ្ទង់, ៣) លិខិតឆ្លងដែន (Passport), ៤) គណនី Socinet និង ៥) ពាក្យសុំ 연계 신청서 [서식 제1호] ដែលប្រព័ន្ធនេះបង្កើតជូនដោយស្វ័យប្រវត្តិ។',
        },
        {
          q: 'តើ TOPIK កម្រិត ១ ដល់ ៦ ប្តូរទៅ KIIP កម្រិតណាខ្លះ?',
          a: 'TOPIK 1급 → KIIP 2단계, TOPIK 2급 → KIIP 3단계, TOPIK 3급 → KIIP 4단계 និង TOPIK 4급–6급 → KIIP 5단계 ដោយមិនចាំបាច់ប្រឡងតេស្តវាស់កម្រិត 사전평가 ឡើយ។',
        },
        {
          q: 'តើបន្ទាប់ពីបង្កើត PDF រួច ត្រូវផ្ញើពាក្យសុំប្តូរ TOPIK ទៅ KIIP តាមណា?',
          a: 'ត្រូវផ្ញើ PDF Merge តាម Email ទៅការិយាល័យអន្តោប្រវេសន៍កូរ៉េប្រចាំតំបន់អាសយដ្ឋានលើកាត ARC របស់អ្នក។ នៅជំហានទី ៥ ប្រព័ន្ធស្វែងរក Email ការិយាល័យត្រឹមត្រូវជូនដោយស្វ័យប្រវត្តិ។',
        },
        {
          q: 'តើប្តូរ TOPIK to KIIP ជួយអ្វីខ្លះដល់ពលករ E-9 ឬអ្នកស្នើវីសា E-7-4 / F-2?',
          a: 'ជួយសន្សំពេលវេលារៀនរាប់រយម៉ោង និងបង្កើនពិន្ទុភាសាកូរ៉េយ៉ាងលឿនសម្រាប់ការប្តូរទិដ្ឋាការ E-9 ទៅ E-7-4, F-2-99 ឬ F-5 នៅកូរ៉េ។',
        },
      ]
    : [
        {
          q: 'What documents are required to convert TOPIK to KIIP?',
          a: 'You need your Alien Registration Card (ARC front & back), a valid TOPIK score certificate with its 16-digit verification number, Passport copy, Socinet account ID, and the official KIIP Integration Form [서식 제1호].',
        },
        {
          q: 'Which KIIP stage does each TOPIK level map to?',
          a: 'TOPIK Level 1 maps to KIIP Stage 2, Level 2 to Stage 3, Level 3 to Stage 4, and Levels 4–6 to Stage 5 without taking the placement test.',
        },
        {
          q: 'Where do I submit the merged TOPIK to KIIP PDF application?',
          a: 'Send the merged PDF via email to your regional Korean Immigration Office (출입국·외국인청). Step 5 automatically matches the exact regional email from your ARC address.',
        },
      ];

  return (
    <section
      aria-labelledby="seo-topik-kiip-heading"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 relative z-10 no-print"
    >
      <div className="bg-white/95 backdrop-blur-sm rounded-3xl border border-slate-200/90 shadow-xs p-5 sm:p-7 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-bold">
              <BookOpen className="w-3.5 h-3.5" />
              <span>TOPIK → KIIP Official Integration Guide</span>
            </div>
            <h2 id="seo-topik-kiip-heading" className="text-lg sm:text-xl font-extrabold text-slate-900">
              {isKo
                ? 'TOPIK 성적 KIIP(사회통합프로그램) 연계 신청 완벽 안내'
                : isKm
                ? 'ប្តូរ TOPIK to KIIP Online — របៀបផ្ទេរពិន្ទុ TOPIK ទៅ KIIP ដោយស្វ័យប្រវត្តិ'
                : 'Convert TOPIK to KIIP Online — Official Application & PDF Merge Guide'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 max-w-3xl leading-relaxed">
              {isKo
                ? 'AI OCR로 외국인등록증(ARC)과 TOPIK 성적증명서를 스캔해 공식 연계 신청서 [서식 제1호] PDF를 즉시 생성하고, 관할 출입국사무소 이메일로 바로 접수하세요.'
                : isKm
                ? 'គេហទំព័រជំនួយបងប្អូនខ្មែរនៅប្រទេសកូរ៉េសម្រាប់ប្តូរពិន្ទុ TOPIK ទៅ KIIP (ប្តរូ TOPIK to KIIP) តាមទូរស័ព្ទ ឬកុំព្យូទ័រ៖ ស្កេនកាត ARC + TOPIK + លិខិតឆ្លងដែន បង្កើតឯកសារ PDF Merge ផ្លូវការ និងផ្ញើទៅការិយាល័យអន្តោប្រវេសន៍កូរ៉េភ្លាមៗ។'
                : 'Automatically scan your ARC, Passport, and TOPIK certificate with AI OCR, generate the official KIIP linkage form [서식 제1호] PDF package, and submit directly to your regional Korean Immigration Office.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onStartNow}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-sm flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
          >
            <span>{isKo ? '지금 연계 신청 시작' : isKm ? 'ចាប់ផ្តើមប្តូរ TOPIK ទៅ KIIP ឥឡូវនេះ' : 'Start TOPIK to KIIP Now'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Conversion Table */}
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                {isKo
                  ? 'TOPIK 급수별 KIIP 단계 연계표'
                  : isKm
                  ? 'តារាងប្តូរកម្រិត TOPIK ទៅ KIIP (TOPIK → KIIP Stage Mapping)'
                  : 'TOPIK Score to KIIP Stage Mapping Table'}
              </span>
            </h3>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="p-3">TOPIK</th>
                    <th className="p-3">KIIP</th>
                    <th className="p-3">{isKo ? '비고' : isKm ? 'អត្ថប្រយោជន៍' : 'Benefit'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {CONVERSION_ROWS.map((row) => (
                    <tr key={row.topik} className="hover:bg-slate-50/70">
                      <td className="p-3 font-bold text-slate-800">{row.topik}</td>
                      <td className="p-3 font-bold text-blue-700">{row.kiip}</td>
                      <td className="p-3 text-slate-600">
                        {isKo ? row.noteKo : isKm ? row.noteKm : row.noteEn}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* FAQ Accordion */}
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-indigo-600" />
              <span>
                {isKo
                  ? '자주 묻는 질문 (FAQ)'
                  : isKm
                  ? 'សំណួរញឹកញាប់អំពីការប្តូរ TOPIK to KIIP (FAQ)'
                  : 'Frequently Asked Questions (TOPIK to KIIP)'}
              </span>
            </h3>
            <div className="space-y-2">
              {faqs.map((item, idx) => {
                const expanded = openFaqIdx === idx;
                return (
                  <div key={item.q} className="rounded-2xl border border-slate-200 bg-slate-50/60 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenFaqIdx(expanded ? null : idx)}
                      aria-expanded={expanded}
                      className="w-full px-4 py-3 text-left flex items-center justify-between gap-2 text-xs sm:text-[13px] font-bold text-slate-800 hover:bg-slate-100/70 cursor-pointer"
                    >
                      <span>{item.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {expanded && (
                      <div className="px-4 pb-3 pt-0.5 text-xs text-slate-600 leading-relaxed border-t border-slate-200/70 bg-white">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
