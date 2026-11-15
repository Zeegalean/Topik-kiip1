import React from 'react';
import { ApplicationFormData, Language, SignatureSettings } from '../types';
import { findOfficeByAddress } from '../data/immigrationOffices';
import { InteractiveSignatureOverlay } from './InteractiveSignatureOverlay';
import { cleanVisaStatus, normalizeDocVerificationNo } from '../utils/sanitizers';
import { KOREAN_VISA_GROUPS, ALL_VISA_CODES } from '../data/visaOptions';

import { WatermarkOverlay } from './WatermarkOverlay';

interface OfficialFormViewProps {
  formData: ApplicationFormData;
  signatureUrl: string | null;
  sigSettings?: SignatureSettings;
  onSigSettingsChange?: React.Dispatch<React.SetStateAction<SignatureSettings>>;
  editable?: boolean;
  onFieldChange?: (field: keyof ApplicationFormData, value: any) => void;
  onDocPartChange?: (index: number, val: string) => void;
  lang?: Language;
  containerRef?: React.Ref<HTMLDivElement>;
  showWatermark?: boolean;
  onRightClickBlock?: () => void;
}

export const OfficialFormView: React.FC<OfficialFormViewProps> = ({
  formData,
  signatureUrl,
  sigSettings = { x: 0, y: 0, scale: 1.0, removeBg: true },
  onSigSettingsChange,
  editable = false,
  onFieldChange,
  onDocPartChange,
  containerRef,
  showWatermark = false,
  onRightClickBlock,
}) => {
  const matchedOffice = findOfficeByAddress(formData.address);

  const getOfficeChiefTitle = () => {
    if (!matchedOffice) {
      return '○○ 출입국·외국인청(사무소)장 귀하';
    }
    const name = matchedOffice.name;
    if (name.endsWith('청')) {
      return `${name}장 귀하`;
    }
    if (name.endsWith('사무소')) {
      return `${name}장 귀하`;
    }
    if (name.endsWith('출장소')) {
      return `${name}장 귀하`;
    }
    return `${name}장 귀하`;
  };

  const handleTextChange = (field: keyof ApplicationFormData, val: string) => {
    if (onFieldChange) onFieldChange(field, val);
  };

  const renderWithNotoSansNumbers = (text: string) => {
    if (!text) return text;
    const parts = text.split(/(\d+)/g);
    return parts.map((part, idx) =>
      /^\d+$/.test(part) ? (
        <span key={idx} className="font-num-kr">
          {part}
        </span>
      ) : (
        <React.Fragment key={idx}>{part}</React.Fragment>
      )
    );
  };

  const normalizedDocs = normalizeDocVerificationNo(formData.docVerificationNo);
  const docPart0 = normalizedDocs[0] || '';
  const docPart1 = normalizedDocs[1] || '';
  const docPart2 = normalizedDocs[2] || '';
  const docPart3 = normalizedDocs[3] || '';

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault();
        if (onRightClickBlock) onRightClickBlock();
      }}
      className="official-form-sheet bg-white text-black shadow-2xl relative select-text overflow-hidden mx-auto"
      style={{
        width: '210mm',
        minHeight: '297mm',
        padding: '13mm 14mm 12mm 14mm',
        fontFamily: '"Noto Serif KR", "Batang", "Nanum Myeongjo", "Malgun Gothic", "Apple SD Gothic Neo", serif',
        boxSizing: 'border-box',
        backgroundColor: '#ffffff',
        color: '#000000',
      }}
    >
      {/* Watermark Overlay (REJECTION) if active */}
      <WatermarkOverlay show={Boolean(showWatermark)} />

      {/* Official Form Header */}
      <div className="mb-3">
        <p className="text-[10px] text-slate-700 mb-1 text-left font-serif">
          [별지 서식] 사회통합정보망(www.socinet.go.kr) - 민원서식
        </p>
        <h1 className="text-[23px] font-bold text-center tracking-[3px] mt-1 font-serif text-black">
          사회통합프로그램 연계 신청서
        </h1>
        <p className="text-[11px] text-center text-slate-600 mt-0.5 tracking-wider font-sans">
          (Application for Korea Immigration & Integration Program Linkage)
        </p>
      </div>

      {/* Main Form Table */}
      <table className="official-form-table w-full border-collapse border-2 border-black text-[13px] leading-snug">
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '25%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '25%' }} />
        </colgroup>
        <tbody>
          {/* Block 1: 신청 대상 */}
          <tr className="border-t-2 border-black">
            <td
              rowSpan={2}
              className="bg-[#f2f2f2] font-bold text-center align-middle p-2 border border-black text-[12.5px]"
            >
              신청 대상
              <br />
              <span className="text-[10px] font-normal text-slate-600 font-sans">
                (※해당√표)
              </span>
            </td>
            <td colSpan={4} className="p-2 border border-black">
              {editable ? (
                <label className="inline-flex items-center gap-2 cursor-pointer font-serif">
                  <input
                    type="checkbox"
                    checked={formData.applyType === 'topik'}
                    onChange={() => handleTextChange('applyType', 'topik')}
                    className="w-4 h-4 accent-black"
                  />
                  <b className="text-[13px]">한국어능력시험(TOPIK) 연계평가 신청</b>
                </label>
              ) : (
                <div className="official-checkbox-row flex items-center gap-2 font-serif font-bold text-[13px] leading-[1.25]">
                  <span className="official-checkbox-box inline-flex items-center justify-center w-3.5 h-3.5 border-[1.25px] border-black bg-white shrink-0">
                    {formData.applyType === 'topik' && (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 stroke-black" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2.2,6.2 5,9 9.8,3" />
                      </svg>
                    )}
                  </span>
                  <span>한국어능력시험(TOPIK) 연계평가 신청</span>
                </div>
              )}
            </td>
          </tr>
          <tr className="border-b-2 border-black">
            <td colSpan={4} className="p-2 border border-black">
              {editable ? (
                <label className="inline-flex items-center gap-2 cursor-pointer font-serif text-slate-700">
                  <input
                    type="checkbox"
                    checked={formData.applyType === 'marriage'}
                    onChange={() => handleTextChange('applyType', 'marriage')}
                    className="w-4 h-4 accent-black"
                  />
                  <span className="text-[13px]">
                    결혼이민사증 소지자의 <span className="font-num-kr">2</span>단계 연계 신청
                  </span>
                </label>
              ) : (
                <div className="official-checkbox-row flex items-center gap-2 font-serif text-[13px] text-slate-800 leading-[1.25]">
                  <span className="official-checkbox-box inline-flex items-center justify-center w-3.5 h-3.5 border-[1.25px] border-black bg-white shrink-0">
                    {formData.applyType === 'marriage' && (
                      <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 stroke-black" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="2.2,6.2 5,9 9.8,3" />
                      </svg>
                    )}
                  </span>
                  <span>
                    결혼이민사증 소지자의 <span className="font-num-kr">2</span>단계 연계 신청
                  </span>
                </div>
              )}
            </td>
          </tr>

          {/* Block 2: 신청인 */}
          <tr className="border-t-2 border-black">
            <td
              rowSpan={6}
              className="bg-[#f2f2f2] font-bold text-center align-middle p-1.5 border border-black tracking-widest text-[13px]"
            >
              신&nbsp;청&nbsp;인
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              성&nbsp;&nbsp;&nbsp;&nbsp;명
            </td>
            <td colSpan={3} className="p-1 border border-black text-left">
              {editable ? (
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleTextChange('name', e.target.value.toUpperCase())}
                  className="w-full h-8 px-2 text-left bg-transparent border-0 font-serif font-bold text-[14px] text-black outline-none"
                  placeholder="SOK SRORNG"
                />
              ) : (
                <div className="font-serif font-bold text-[14px] px-2 text-left leading-[1.25] text-black">
                  {renderWithNotoSansNumbers(formData.name || '')}
                </div>
              )}
            </td>
          </tr>

          <tr>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black leading-tight text-[11.5px]">
              외국인(주민)
              <br />
              등록번호
            </td>
            <td className="p-1 border border-black">
              {editable ? (
                <div className="flex items-center justify-center gap-1 w-full">
                  <input
                    type="text"
                    maxLength={6}
                    value={formData.regNumber1}
                    onChange={(e) =>
                      handleTextChange('regNumber1', e.target.value.replace(/[^0-9]/g, ''))
                    }
                    className="w-[46%] h-8 text-center bg-transparent border-0 font-num-kr font-bold text-[14px] outline-none"
                    placeholder="YYMMDD"
                  />
                  <span className="font-num-kr font-bold">-</span>
                  <input
                    type="text"
                    maxLength={7}
                    value={formData.regNumber2}
                    onChange={(e) =>
                      handleTextChange('regNumber2', e.target.value.replace(/[^0-9]/g, ''))
                    }
                    className="w-[46%] h-8 text-center bg-transparent border-0 font-num-kr font-bold text-[14px] outline-none"
                    placeholder="5760023"
                  />
                </div>
              ) : (
                <div className="font-num-kr font-bold text-[14px] text-center leading-[1.25] tracking-wider">
                  {formData.regNumber1 && formData.regNumber2 ? `${formData.regNumber1} - ${formData.regNumber2}` : (formData.regNumber1 || formData.regNumber2 || '')}
                </div>
              )}
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              성&nbsp;&nbsp;별
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <select
                  value={formData.gender}
                  onChange={(e) => handleTextChange('gender', e.target.value)}
                  className="w-full h-8 bg-transparent border-0 font-serif text-center outline-none cursor-pointer font-bold"
                >
                  <option value="">선택</option>
                  <option value="남">남 (Male)</option>
                  <option value="여">여 (Female)</option>
                </select>
              ) : (
                <div className="font-serif font-bold text-[13px] leading-[1.25]">
                  {formData.gender ? `${formData.gender}자` : '남자'}
                </div>
              )}
            </td>
          </tr>

          <tr>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              국&nbsp;&nbsp;&nbsp;&nbsp;적
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="text"
                  value={formData.nationality}
                  onChange={(e) => handleTextChange('nationality', e.target.value)}
                  className="w-full h-8 px-2 text-center bg-transparent border-0 font-serif font-bold text-[13px] outline-none"
                  placeholder="Cambodia"
                />
              ) : (
                <div className="font-serif font-bold text-[13px] leading-[1.25]">
                  {formData.nationality || 'Cambodia'}
                </div>
              )}
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              체류자격
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <select
                  value={formData.visaStatus || ''}
                  onChange={(e) => handleTextChange('visaStatus', e.target.value)}
                  className="w-full h-8 px-1 text-[12px] font-num-kr font-bold bg-transparent border-0 text-center text-black outline-none cursor-pointer"
                  title="체류자격 선택"
                >
                  <option value="">선택</option>
                  {formData.visaStatus && !ALL_VISA_CODES.includes(formData.visaStatus) && (
                    <option value={formData.visaStatus}>{formData.visaStatus}</option>
                  )}
                  {KOREAN_VISA_GROUPS.map((g) => (
                    <optgroup key={g.groupName} label={g.groupNameKo}>
                      {g.items.map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.labelKo}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25]">
                  {formData.visaStatus || 'E-9-1'}
                </div>
              )}
            </td>
          </tr>
          <tr>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              여권번호
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="text"
                  value={formData.passportNo || ""}
                  onChange={(e) => handleTextChange("passportNo", e.target.value.toUpperCase().trim())}
                  className="w-full h-8 px-2 text-center bg-transparent border-0 font-num-kr font-bold text-[13px] text-black outline-none tracking-wider"
                  placeholder="N01847291"
                />
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25] tracking-wider">
                  {formData.passportNo || "N01847291"}
                </div>
              )}
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black leading-tight text-[11.5px]">
              여권 유효기간
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="text"
                  value={formData.passportExpiry || ""}
                  onChange={(e) => handleTextChange("passportExpiry", e.target.value)}
                  className="w-full h-8 px-2 text-center bg-transparent border-0 font-num-kr font-bold text-[13px] text-black outline-none"
                  placeholder="YYYY-MM-DD"
                />
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25]">
                  {formData.passportExpiry || "2031-08-15"}
                </div>
              )}
            </td>
          </tr>

          <tr>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              체&nbsp;류&nbsp;지
            </td>
            <td colSpan={3} className="p-1 border border-black text-left">
              {editable ? (
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => handleTextChange('address', e.target.value)}
                  className="w-full h-8 px-2 text-left bg-transparent border-0 font-serif font-bold text-[13px] text-black outline-none"
                  placeholder="충청남도 서산시 수석동..."
                />
              ) : (
                <div className="font-serif font-bold text-[12.5px] px-2 text-left leading-[1.25] text-black">
                  {renderWithNotoSansNumbers(formData.address || '')}
                </div>
              )}
            </td>
          </tr>

          <tr className="border-b-2 border-black">
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              전화번호
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => handleTextChange('phone', e.target.value)}
                  className="w-full h-8 px-2 text-center bg-transparent border-0 font-num-kr font-bold text-[13px] text-black outline-none"
                  placeholder="041-000-0000"
                />
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25]">
                  {formData.phone || formData.mobile || ''}
                </div>
              )}
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1 border border-black">
              휴대폰
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="text"
                  value={formData.mobile}
                  onChange={(e) => handleTextChange('mobile', e.target.value)}
                  className="w-full h-8 px-2 text-center bg-transparent border-0 font-num-kr font-bold text-[13px] text-black outline-none"
                  placeholder="010-1234-5678"
                />
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25]">
                  {formData.mobile || formData.phone || ''}
                </div>
              )}
            </td>
          </tr>

          {/* Block 3: 한국어능력시험 성적증명서 (OFFICIAL TOPIK SCORE REPORT) */}
          <tr className="border-t-2 border-black">
            <td
              rowSpan={4}
              className="bg-[#f2f2f2] font-bold text-center align-middle p-2 border border-black text-[12px] leading-tight"
            >
              한국어
              <br />
              능력시험
              <br />
              성적증명서
              <br />
              <span className="text-[9.5px] font-normal text-slate-700 font-sans block mt-1">
                (OFFICIAL
                <br />
                TOPIK SCORE
                <br />
                REPORT)
              </span>
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1.5 border border-black text-[12.5px]">
              문서확인번호
            </td>
            <td colSpan={3} className="p-2 border border-black text-center">
              {editable ? (
                <div className="flex flex-col items-center justify-center gap-1 w-full">
                  <div className="flex items-center justify-center gap-1.5 w-full font-num-kr">
                    {[0, 1, 2, 3].map((idx) => (
                      <React.Fragment key={idx}>
                        <input
                          type="text"
                          maxLength={4}
                          value={formData.docVerificationNo?.[idx] || ''}
                          onChange={(e) => {
                            if (onDocPartChange) onDocPartChange(idx, e.target.value);
                          }}
                          className="w-16 h-8 text-center bg-white border border-slate-500 font-num-kr font-bold text-[15pt] text-black outline-none"
                          placeholder="0000"
                        />
                        {idx < 3 && <span className="font-num-kr font-bold text-[15pt]">-</span>}
                      </React.Fragment>
                    ))}
                  </div>
                  <span className="text-[10px] text-slate-600 font-sans">
                    ※ 온라인 출력 성적증명서의 경우 작성
                  </span>
                </div>
              ) : (
                <div>
                  <div
                    className="font-num-kr font-bold text-[16px] text-center tracking-widest leading-[1.25] text-black"
                  >
                    {docPart0 || docPart1 || docPart2 || docPart3
                      ? `${docPart0 || ''} - ${docPart1 || ''} - ${docPart2 || ''} - ${docPart3 || ''}`
                      : ''}
                  </div>
                  <span className="text-[10px] text-slate-500 font-sans block mt-0.5 leading-[1.25]">
                    ※ 온라인 출력 성적증명서 확인번호 (16자리)
                  </span>
                </div>
              )}
            </td>
          </tr>

          <tr>
            <td
              colSpan={2}
              className="bg-[#f2f2f2] font-bold text-center p-1.5 border border-black text-[12px]"
            >
              <div className="flex flex-wrap items-center justify-center gap-x-1 leading-[1.25]">
                <span>수&nbsp;험&nbsp;번&nbsp;호</span>
                <span className="text-[10px] font-normal text-slate-600 font-sans">
                  (Registration No. / Application No.)
                </span>
              </div>
            </td>
            <td colSpan={2} className="p-1 border border-black text-center">
              {editable ? (
                <div className="font-num-kr">
                  <input
                    type="text"
                    value={formData.examNumber}
                    onChange={(e) => handleTextChange('examNumber', e.target.value)}
                    className="w-full h-8 px-2 text-center bg-transparent border-0 font-num-kr font-bold text-[14px] text-black outline-none tracking-wider"
                    placeholder="0010197000017"
                  />
                </div>
              ) : (
                <div
                  className="font-num-kr font-bold text-[14px] text-center leading-[1.25] tracking-wider text-black"
                >
                  {formData.examNumber || ''}
                </div>
              )}
            </td>
          </tr>

          <tr>
            <td className="bg-[#f2f2f2] font-bold text-center p-1.5 border border-black text-[12px]">
              시&nbsp;험&nbsp;일
              <br />
              <span className="text-[10px] font-normal text-slate-600 font-sans">
                (Test Date)
              </span>
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="date"
                  value={formData.examDate}
                  onChange={(e) => handleTextChange('examDate', e.target.value)}
                  className="w-full h-8 bg-transparent border-0 font-num-kr font-bold text-[13px] text-center outline-none"
                />
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25] text-center">
                  {formData.examDate || ''}
                </div>
              )}
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1.5 border border-black text-[12px]">
              회&nbsp;&nbsp;&nbsp;&nbsp;차
              <br />
              <span className="text-[10px] font-normal text-slate-600 font-sans">
                (Test Held)
              </span>
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <div className="flex items-center justify-center gap-1">
                  <input
                    type="text"
                    value={formData.round}
                    onChange={(e) =>
                      handleTextChange('round', e.target.value.replace(/[^0-9]/g, ''))
                    }
                    className="w-16 h-8 text-center bg-transparent border-0 font-num-kr font-bold text-[14px] outline-none"
                    placeholder="107"
                  />
                  <span className="font-bold">회</span>
                </div>
              ) : (
                <div className="font-serif font-bold text-[13.5px] leading-[1.25] text-center">
                  {formData.round ? (
                    <>
                      제 <span className="font-num-kr">{formData.round}</span> 회
                    </>
                  ) : (
                    ''
                  )}
                </div>
              )}
            </td>
          </tr>

          <tr className="border-b-2 border-black">
            <td className="bg-[#f2f2f2] font-bold text-center p-1.5 border border-black text-[12px]">
              성적유효기간
              <br />
              <span className="text-[10px] font-normal text-slate-600 font-sans">
                (Valid Until)
              </span>
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <input
                  type="date"
                  value={formData.validUntil}
                  onChange={(e) => handleTextChange('validUntil', e.target.value)}
                  className="w-full h-8 bg-transparent border-0 font-num-kr font-bold text-[13px] text-center outline-none"
                />
              ) : (
                <div className="font-num-kr font-bold text-[13px] leading-[1.25] text-center text-rose-700">
                  {formData.validUntil || ''}
                </div>
              )}
            </td>
            <td className="bg-[#f2f2f2] font-bold text-center p-1.5 border border-black text-[12px]">
              등&nbsp;&nbsp;&nbsp;&nbsp;급
              <br />
              <span className="text-[10px] font-normal text-slate-600 font-sans">
                (Grade)
              </span>
            </td>
            <td className="p-1 border border-black text-center">
              {editable ? (
                <select
                  value={formData.grade}
                  onChange={(e) => handleTextChange('grade', e.target.value)}
                  className="w-full h-8 bg-transparent border-0 font-num-kr font-bold text-[14px] text-center outline-none cursor-pointer"
                >
                  <option value="">선택</option>
                  <option value="1급">1급 (Level 1)</option>
                  <option value="2급">2급 (Level 2)</option>
                  <option value="3급">3급 (Level 3)</option>
                  <option value="4급">4급 (Level 4)</option>
                  <option value="5급">5급 (Level 5)</option>
                  <option value="6급">6급 (Level 6)</option>
                </select>
              ) : (
                <div className="font-serif font-bold text-[14px] leading-[1.25] text-center text-emerald-800">
                  {renderWithNotoSansNumbers(formData.grade || '0급')}
                </div>
              )}
            </td>
          </tr>

          {/* Block 4: 해외 한국어 교육기관 이수증 사항 (결혼이민자 전용) */}
          <tr className="border-t-2 border-b-2 border-black">
            <td className="bg-[#f2f2f2] font-bold text-center align-middle p-2 border border-black text-[11.5px] leading-tight">
              법무부 지정
              <br />
              해외 한국어
              <br />
              교육기관
              <br />
              이수증 사항
            </td>
            <td colSpan={2} className="p-2 border border-black align-middle text-center">
              <div>
                <div className="font-bold text-[11.5px] mb-1 leading-[1.25]">교육기관명</div>
                {editable ? (
                  <input
                    type="text"
                    value={formData.instituteName}
                    onChange={(e) => handleTextChange('instituteName', e.target.value)}
                    className="w-full h-7 text-center bg-transparent border-b border-slate-300 font-serif text-[12.5px] outline-none"
                    placeholder="해당 시 기재"
                  />
                ) : (
                  <div className="font-serif text-[12px] min-h-[18px] leading-[1.25] text-center text-slate-800">
                    {renderWithNotoSansNumbers(formData.instituteName || '-')}
                  </div>
                )}
                <div className="text-[10px] text-slate-500 mt-1 font-sans leading-[1.25]">
                  ※ 결혼이민사증 2단계 연계자만 작성
                </div>
              </div>
            </td>
            <td colSpan={2} className="p-2 border border-black align-middle text-center">
              <div>
                <div className="font-bold text-[11.5px] mb-1 leading-[1.25]">이수일자</div>
                {editable ? (
                  <input
                    type="date"
                    value={formData.completionDate}
                    onChange={(e) => handleTextChange('completionDate', e.target.value)}
                    className="w-full h-7 text-center bg-transparent border-b border-slate-300 font-num-kr text-[12px] outline-none"
                  />
                ) : (
                  <div className="font-num-kr text-[12px] min-h-[18px] leading-[1.25] text-center text-slate-800">
                    {formData.completionDate || '-'}
                  </div>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Official Socinet Linkage Verification Box (CSS Flexbox & Grid Input Boxes) */}
      <div className="official-socinet-box font-sans">
        <div className="official-socinet-header">
          <span className="font-medium font-serif text-[9.5px] text-slate-700">
            ※ 사회통합정보망(Socinet) 계정 정보 (연계 접수 확인용)
          </span>
          <span className="text-[8.5px] text-slate-500 font-normal tracking-wide">
            www.socinet.go.kr
          </span>
        </div>

        <div className="official-socinet-grid">
          <div className="official-socinet-field">
            <label className="official-socinet-label" htmlFor="official-socinet-id">
              아이디 (ID)
            </label>
            <div className="official-socinet-input-box">
              {editable && onFieldChange ? (
                <input
                  id="official-socinet-id"
                  type="text"
                  value={formData.socinetId || ''}
                  onChange={(e) => handleTextChange('socinetId', e.target.value)}
                  placeholder="Socinet ID"
                  className="official-socinet-input select-text"
                />
              ) : (
                <span className="official-socinet-value">
                  {formData.socinetId || '-'}
                </span>
              )}
            </div>
          </div>

          <div className="official-socinet-field">
            <label className="official-socinet-label" htmlFor="official-socinet-pw">
              비밀번호 (PW)
            </label>
            <div className="official-socinet-input-box">
              {editable && onFieldChange ? (
                <input
                  id="official-socinet-pw"
                  type="text"
                  value={formData.socinetPw || ''}
                  onChange={(e) => handleTextChange('socinetPw', e.target.value)}
                  placeholder="Socinet Password"
                  className="official-socinet-input select-text"
                />
              ) : (
                <span className="official-socinet-value">
                  {formData.socinetPw || '-'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Official Declaration Block */}
      <div className="text-center my-4 text-[13.5px] leading-relaxed font-bold font-serif">
        <p>나는 위에 기재한 사항이 사실과 틀림없음을 서약하고,</p>
        <p>사회통합프로그램 연계를 신청합니다.</p>
      </div>

      {/* Privacy Consent Box */}
      <div className="bg-[#fbfbfb] border-t-[1.5px] border-b border-black p-2.5 text-[11px] leading-snug font-serif">
        <div className="official-consent-row">
          <span className="official-consent-text">
            o 상기 본인은 사회통합프로그램 연계 신청을 위한 개인정보 이용에 동의합니다.
          </span>
          <div className="official-consent-options">
            <span className="official-consent-option">
              <span className="official-checkbox-box inline-flex items-center justify-center w-3 h-3 border-[1.25px] border-black bg-white shrink-0">
                {formData.consent === 'agree' && (
                  <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 stroke-black" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2.2,6.2 5,9 9.8,3" />
                  </svg>
                )}
              </span>
              <span>동의함</span>
            </span>
            <span className="official-consent-option">
              <span className="official-checkbox-box inline-flex items-center justify-center w-3 h-3 border-[1.25px] border-black bg-white shrink-0">
                {formData.consent === 'disagree' && (
                  <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 stroke-black" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2.2,6.2 5,9 9.8,3" />
                  </svg>
                )}
              </span>
              <span>동의하지 않음</span>
            </span>
          </div>
        </div>
        <p className="text-[10.5px] text-slate-700 pl-2">
          • 이용·보유기간 : 제공일로부터 <span className="font-num-kr">5</span>년(보유기간 경과 시 즉각 폐기) - 개인정보보호법 제<span className="font-num-kr">15</span>조 및 제<span className="font-num-kr">24</span>조 의거
        </p>
        <p className="text-[10.5px] text-slate-700 pl-2">
          • 거부시 불이익 조치 : 개인정보이용제공 부동의 시 본 연계 신청 불가
        </p>
      </div>

      {/* Warning Box */}
      <div className="border-b-[1.5px] border-black p-2 bg-white text-[10.5px] text-slate-800 leading-normal font-serif">
        <p>
          ※ 신청서에 허위사실을 기재하거나 허위의 한국어능력시험 성적증명서 또는 이수증(수료증)을 제출하였을 경우 당해 연계 신청 및 승인된 후 수료한 모든 사회통합프로그램 과정이 무효가 되며 이와 관련하여 처벌받을 수 있음
        </p>
      </div>

      {/* Footer with Date, Applicant Name, Signature Stamp & Office Destination */}
      <div className="mt-4 flex flex-col font-serif">
        <div className="ml-auto mr-4 mb-5 text-right space-y-2">
          {/* Application Date: Auto-detected current date with manual editing */}
          <div className="flex items-center justify-end gap-1.5 text-[12.5px] font-bold">
            <span>신청일자&nbsp;:&nbsp;&nbsp;</span>
            {editable ? (
              <>
                <input
                  type="text"
                  maxLength={4}
                  value={formData.applyYear || ""}
                  onChange={(e) => handleTextChange("applyYear", e.target.value)}
                  className="w-14 text-center bg-transparent border-b border-black font-num-kr font-bold text-[12.5px] outline-none"
                  placeholder={new Date().getFullYear().toString()}
                />
                <span>년</span>
                <input
                  type="text"
                  maxLength={2}
                  value={formData.applyMonth || ""}
                  onChange={(e) => handleTextChange("applyMonth", e.target.value)}
                  className="w-8 text-center bg-transparent border-b border-black font-num-kr font-bold text-[12.5px] outline-none"
                  placeholder={String(new Date().getMonth() + 1).padStart(2, "0")}
                />
                <span>월</span>
                <input
                  type="text"
                  maxLength={2}
                  value={formData.applyDay || ""}
                  onChange={(e) => handleTextChange("applyDay", e.target.value)}
                  className="w-8 text-center bg-transparent border-b border-black font-num-kr font-bold text-[12.5px] outline-none"
                  placeholder={String(new Date().getDate()).padStart(2, "0")}
                />
                <span>일</span>
                <input
                  type="date"
                  aria-label="신청일자 달력 선택"
                  value={(() => {
                    const now = new Date();
                    const y = /^\d{4}$/.test(formData.applyYear || '') && formData.applyYear !== '0000'
                      ? formData.applyYear
                      : String(now.getFullYear());
                    const m = /^\d{1,2}$/.test(formData.applyMonth || '') && formData.applyMonth !== '00'
                      ? String(formData.applyMonth).padStart(2, '0')
                      : String(now.getMonth() + 1).padStart(2, '0');
                    const d = /^\d{1,2}$/.test(formData.applyDay || '') && formData.applyDay !== '00'
                      ? String(formData.applyDay).padStart(2, '0')
                      : String(now.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                  })()}
                  onChange={(e) => {
                    const [y, m, d] = e.target.value.split('-');
                    if (y && m && d) {
                      handleTextChange("applyYear", y);
                      handleTextChange("applyMonth", m);
                      handleTextChange("applyDay", d);
                    }
                  }}
                  className="no-print ml-1.5 px-1.5 py-0.5 text-[11px] font-num-kr font-bold bg-blue-50 hover:bg-blue-100 border border-blue-300 rounded-md text-blue-900 cursor-pointer outline-none"
                  title="ជ្រើសរើសថ្ងៃ ខែ ឆ្នាំ ពីប្រតិទិន (달력 선택)"
                />
              </>
            ) : (
              <>
                <span>
                  <span className="font-num-kr">
                    {formData.applyYear && formData.applyYear !== "0000" ? formData.applyYear : new Date().getFullYear()}
                  </span>
                  년
                </span>
                <span>
                  <span className="font-num-kr">
                    {formData.applyMonth && formData.applyMonth !== "00" ? formData.applyMonth : String(new Date().getMonth() + 1).padStart(2, "0")}
                  </span>
                  월
                </span>
                <span>
                  <span className="font-num-kr">
                    {formData.applyDay && formData.applyDay !== "00" ? formData.applyDay : String(new Date().getDate()).padStart(2, "0")}
                  </span>
                  일
                </span>
              </>
            )}
          </div>

          {/* Applicant Name & Signature Stamp */}
          <div className="relative flex items-center justify-end gap-2 text-[12.5px] pt-1">
            <span className="font-bold">신&nbsp;청&nbsp;자&nbsp;:&nbsp;&nbsp;</span>
            <span className="font-bold tracking-wider text-[13px] text-black">
              {formData.applicantName || formData.name || ''}
            </span>
            <span className="text-[11px] text-slate-600 font-normal">
              (서명 또는 인)
            </span>

            {/* Render Transparent Interactive Signature Stamp */}
            {signatureUrl && (
              <InteractiveSignatureOverlay
                signatureUrl={signatureUrl}
                sigSettings={sigSettings}
                setSigSettings={onSigSettingsChange || (() => {})}
                readOnly={!onSigSettingsChange}
              />
            )}


          </div>
        </div>

        {/* Dynamic Chief Designation */}
        <p className="text-[14px] font-bold text-left mt-3 tracking-wide">
          {getOfficeChiefTitle()}
        </p>
      </div>
    </div>
  );
};
