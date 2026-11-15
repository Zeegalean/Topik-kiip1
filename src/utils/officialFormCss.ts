/**
 * 100% pure classic sRGB CSS stylesheet for OfficialFormView, WatermarkOverlay, and InteractiveSignatureOverlay.
 * Contains ZERO Tailwind CSS v4 constructs (no oklch, oklab, color-mix, @property, or backdrop-filter)
 * so html2canvas renders an exact pixel-identical copy of the on-screen Form Preview.
 */
export const OFFICIAL_FORM_PURE_CSS = `
  *, *::before, *::after {
    box-sizing: border-box;
    animation: none !important;
    transition: none !important;
  }

  html, body {
    margin: 0;
    padding: 0;
    background-color: #ffffff;
    color: #000000;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", "Malgun Gothic", "Apple SD Gothic Neo", serif;
    -webkit-font-smoothing: antialiased;
  }

  .official-form-sheet {
    width: 794px;
    min-height: 1123px;
    padding: 49px 53px 45px 53px;
    box-sizing: border-box;
    background-color: #ffffff;
    color: #000000;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", "Malgun Gothic", "Apple SD Gothic Neo", serif;
    letter-spacing: normal;
    position: relative;
    overflow: hidden;
    margin: 0 auto;
    box-shadow: none;
  }

  .official-form-sheet .font-sans,
  .official-socinet-box,
  .official-socinet-label,
  .official-socinet-input,
  .official-socinet-value,
  .ofv-subtitle,
  .ofv-sub-note,
  .ofv-block3-note,
  .ofv-inst-note {
    font-family: "Noto Sans KR", "Inter", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  }

  .font-serif {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", "Malgun Gothic", "Apple SD Gothic Neo", serif;
  }

  .font-num-kr {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", "Malgun Gothic", serif;
    font-variant-numeric: tabular-nums;
  }

  /* Header */
  .ofv-header {
    margin-bottom: 12px;
  }

  .ofv-kicker {
    font-size: 10px;
    color: #334155;
    margin: 0 0 4px 0;
    text-align: left;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    line-height: 1.4;
  }

  .ofv-title {
    font-size: 23px;
    font-weight: 700;
    text-align: center;
    letter-spacing: 3px;
    margin: 4px 0 0 0;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    color: #000000;
    line-height: 1.35;
  }

  .ofv-subtitle {
    font-size: 11px;
    text-align: center;
    color: #475569;
    margin: 2px 0 0 0;
    letter-spacing: 0.05em;
    line-height: 1.4;
  }

  /* Main Form Table */
  .official-form-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    border: 2px solid #000000;
    font-size: 13px;
    line-height: 1.375;
    color: #000000;
    background-color: #ffffff;
  }

  .official-form-table th,
  .official-form-table td {
    border: 1px solid #000000;
    vertical-align: middle;
    box-sizing: border-box;
    padding: 6px 8px;
    line-height: 1.25;
  }

  .official-form-table tr.ofv-tr-top > th,
  .official-form-table tr.ofv-tr-top > td {
    border-top: 2px solid #000000;
  }

  .official-form-table tr.ofv-tr-bottom > th,
  .official-form-table tr.ofv-tr-bottom > td {
    border-bottom: 2px solid #000000;
  }

  .official-form-table td > div,
  .official-form-table th > div {
    margin-top: 0;
    margin-bottom: 0;
  }

  .ofv-label-cell {
    background-color: #f2f2f2;
    font-weight: 700;
    text-align: center;
    color: #000000;
  }

  .ofv-data-cell {
    background-color: #ffffff;
    color: #000000;
  }

  .ofv-text-left {
    text-align: left;
  }

  .ofv-text-center {
    text-align: center;
  }

  .ofv-label-target {
    font-size: 12.5px;
  }

  .ofv-label-applicant {
    letter-spacing: 0.1em;
    font-size: 13px;
  }

  .ofv-label-reg {
    line-height: 1.25;
    font-size: 11.5px;
  }

  .ofv-label-passport-exp {
    line-height: 1.25;
    font-size: 11.5px;
  }

  .ofv-label-topik-block {
    font-size: 12px;
    line-height: 1.25;
  }

  .ofv-label-docno {
    font-size: 12.5px;
  }

  .ofv-label-sm {
    font-size: 12px;
  }

  .ofv-label-inst-block {
    font-size: 11.5px;
    line-height: 1.25;
  }

  .ofv-sub-note {
    font-size: 10px;
    font-weight: 400;
    color: #475569;
  }

  .ofv-block3-note {
    font-size: 9.5px;
    font-weight: 400;
    color: #334155;
    display: block;
    margin-top: 4px;
    line-height: 1.25;
  }

  .ofv-docno-note {
    font-size: 10px;
    color: #64748b;
    display: block;
    margin-top: 2px;
    line-height: 1.25;
    font-family: "Noto Sans KR", "Inter", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  }

  .ofv-checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-size: 13px;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-checkbox-row-bold {
    font-weight: 700;
    color: #000000;
  }

  .ofv-checkbox-row-muted {
    font-weight: 400;
    color: #1e293b;
  }

  .ofv-checkbox-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: 1.25px solid #000000;
    background-color: #ffffff;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .ofv-checkbox-box-sm {
    width: 12px;
    height: 12px;
  }

  .ofv-val-name {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-weight: 700;
    font-size: 14px;
    padding: 0 8px;
    text-align: left;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-val-reg {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 14px;
    text-align: center;
    line-height: 1.25;
    letter-spacing: 0.05em;
    color: #000000;
  }

  .ofv-val-gender {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-weight: 700;
    font-size: 13px;
    text-align: center;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-val-center {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 13px;
    text-align: center;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-val-passport {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 13px;
    text-align: center;
    line-height: 1.25;
    letter-spacing: 0.05em;
    color: #000000;
  }

  .ofv-val-addr {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-weight: 700;
    font-size: 12.5px;
    padding: 0 8px;
    text-align: left;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-val-docno {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 16px;
    text-align: center;
    letter-spacing: 0.1em;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-exam-label-wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    column-gap: 4px;
    line-height: 1.25;
  }

  .ofv-val-examno {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 14px;
    text-align: center;
    line-height: 1.25;
    letter-spacing: 0.05em;
    color: #000000;
  }

  .ofv-val-round {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-weight: 700;
    font-size: 13.5px;
    line-height: 1.25;
    text-align: center;
    color: #000000;
  }

  .ofv-val-valid {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 13px;
    line-height: 1.25;
    text-align: center;
    color: #be123c;
  }

  .ofv-val-grade {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-weight: 700;
    font-size: 14px;
    line-height: 1.25;
    text-align: center;
    color: #065f46;
  }

  .ofv-inst-title {
    font-weight: 700;
    font-size: 11.5px;
    margin-bottom: 4px;
    line-height: 1.25;
    color: #000000;
  }

  .ofv-inst-val {
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-size: 12px;
    min-height: 18px;
    line-height: 1.25;
    text-align: center;
    color: #1e293b;
  }

  .ofv-inst-note {
    font-size: 10px;
    color: #64748b;
    margin-top: 4px;
    line-height: 1.25;
  }

  /* Socinet Account Section */
  .official-socinet-box {
    margin: 5px 0;
    padding: 5px 8px;
    background-color: #f8fafc;
    border: 1px solid #475569;
    box-sizing: border-box;
    color: #334155;
  }

  .official-socinet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-bottom: 3px;
    margin-bottom: 4px;
    border-bottom: 1px solid #cbd5e1;
  }

  .official-socinet-header-title {
    font-weight: 500;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    font-size: 9.5px;
    color: #334155;
  }

  .official-socinet-url {
    font-size: 8.5px;
    color: #64748b;
    font-weight: 400;
    letter-spacing: 0.025em;
  }

  .official-socinet-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    align-items: center;
  }

  .official-socinet-field {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .official-socinet-label {
    flex-shrink: 0;
    min-width: 62px;
    font-size: 9.5px;
    font-weight: 500;
    color: #475569;
    line-height: 1.2;
  }

  .official-socinet-input-box {
    flex: 1 1 0%;
    min-width: 0;
    min-height: 22px;
    padding: 2px 7px;
    background-color: #ffffff;
    border: 1px solid #94a3b8;
    border-radius: 3px;
    display: flex;
    align-items: center;
    box-sizing: border-box;
  }

  .official-socinet-value {
    display: block;
    width: 100%;
    font-size: 9.5px;
    font-weight: 400;
    color: #334155;
    line-height: 1.25;
    white-space: normal;
    word-break: break-all;
    overflow: visible;
  }

  /* Declaration Block */
  .ofv-declaration {
    text-align: center;
    margin: 16px 0;
    font-size: 13.5px;
    line-height: 1.625;
    font-weight: 700;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    color: #000000;
  }

  .ofv-declaration p {
    margin: 0;
  }

  /* Privacy Consent Box */
  .ofv-privacy {
    background-color: #fbfbfb;
    border-top: 1.5px solid #000000;
    border-bottom: 1px solid #000000;
    padding: 10px;
    font-size: 11px;
    line-height: 1.375;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    color: #000000;
  }

  .official-consent-row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .official-consent-text {
    font-weight: 700;
    font-size: 11px;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 0;
    color: #000000;
  }

  .official-consent-options {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 11.5px;
    font-weight: 700;
    color: #000000;
  }

  .official-consent-option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .ofv-privacy-bullet {
    font-size: 10.5px;
    color: #334155;
    padding-left: 8px;
    margin: 0;
    line-height: 1.4;
  }

  /* Warning Box */
  .ofv-warning {
    border-bottom: 1.5px solid #000000;
    padding: 8px;
    background-color: #ffffff;
    font-size: 10.5px;
    color: #1e293b;
    line-height: 1.5;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
  }

  .ofv-warning p {
    margin: 0;
  }

  /* Footer */
  .ofv-footer {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    font-family: "Noto Serif KR", "Batang", "Nanum Myeongjo", serif;
    color: #000000;
  }

  .ofv-footer-right {
    margin-left: auto;
    margin-right: 16px;
    margin-bottom: 20px;
    text-align: right;
  }

  .ofv-date-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 700;
    margin-bottom: 8px;
    color: #000000;
  }

  .ofv-applicant-row {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    font-size: 12.5px;
    padding-top: 4px;
    color: #000000;
  }

  .ofv-applicant-label {
    font-weight: 700;
  }

  .ofv-applicant-name {
    font-weight: 700;
    letter-spacing: 0.05em;
    font-size: 13px;
    color: #000000;
  }

  .ofv-seal-hint {
    font-size: 11px;
    color: #475569;
    font-weight: 400;
  }

  .ofv-chief {
    font-size: 14px;
    font-weight: 700;
    text-align: left;
    margin: 12px 0 0 0;
    letter-spacing: 0.025em;
    color: #000000;
  }

  /* Interactive Signature Overlay (ReadOnly PDF view) */
  .sig-overlay-wrapper {
    position: absolute;
    user-select: none;
  }

  .sig-overlay-frame-readonly {
    position: relative;
    padding: 6px;
    pointer-events: none;
  }

  .sig-overlay-img {
    height: 56px;
    max-width: 165px;
    width: auto;
    object-fit: contain;
    display: block;
    user-select: none;
    pointer-events: none;
  }

  /* Watermark Overlay (Form variant) - 100% sRGB */
  .wm-form-root {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 30;
    pointer-events: none;
    overflow: hidden;
    user-select: none;
  }

  .wm-grid {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 32px 0;
    opacity: 0.15;
    overflow: hidden;
  }

  .wm-grid-row {
    display: flex;
    justify-content: space-around;
    align-items: center;
    white-space: nowrap;
    transform: rotate(-30deg) scale(1.1);
  }

  .wm-grid-text {
    color: #b91c1c;
    font-weight: 800;
    font-size: 15px;
    letter-spacing: 4px;
    margin: 0 24px;
    text-transform: uppercase;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .wm-badge {
    position: absolute;
    top: 24px;
    right: 24px;
    transform: rotate(6deg);
    border: 3px dashed rgba(220, 38, 38, 0.8);
    border-radius: 12px;
    padding: 10px;
    background-color: rgba(254, 242, 242, 0.85);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    max-width: 210px;
    text-align: center;
  }

  .wm-badge-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: #b91c1c;
    font-weight: 900;
    font-size: 12px;
    letter-spacing: 0.05em;
  }

  .wm-badge-ko {
    font-size: 9px;
    font-weight: 700;
    color: #991b1b;
    font-family: "Noto Serif KR", "Batang", serif;
    margin: 2px 0 0 0;
    line-height: 1.25;
  }

  .wm-badge-sub {
    font-size: 8.5px;
    font-weight: 500;
    color: #334155;
    margin: 2px 0 0 0;
    line-height: 1.25;
  }

  .wm-center-wrap {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .wm-center-tilt {
    transform: rotate(-28deg) translateY(-16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .wm-center-box {
    border: 6px solid rgba(220, 38, 38, 0.85);
    border-radius: 24px;
    padding: 20px 56px;
    background-color: rgba(239, 68, 68, 0.1);
    box-shadow: 0 20px 25px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .wm-center-kicker {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #b91c1c;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 4px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .wm-center-title {
    color: #dc2626;
    font-weight: 900;
    font-size: 72px;
    letter-spacing: 14px;
    text-transform: uppercase;
    line-height: 1;
    margin: 0;
    font-family: "Noto Sans KR", "Inter", sans-serif;
  }

  .wm-center-sub {
    margin-top: 8px;
    text-align: center;
  }

  .wm-center-sub-main {
    color: #991b1b;
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.025em;
    font-family: "Noto Serif KR", "Batang", serif;
    margin: 0;
  }

  .wm-center-sub-en {
    font-size: 11px;
    font-weight: 700;
    color: #b91c1c;
    margin: 4px 0 0 0;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .wm-center-meta {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid rgba(239, 68, 68, 0.4);
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 9px;
    color: rgba(185, 28, 28, 0.9);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .wm-bottom-strip {
    position: absolute;
    bottom: 16px;
    left: 16px;
    right: 16px;
    background-color: rgba(220, 38, 38, 0.9);
    color: #ffffff;
    padding: 8px 16px;
    border-radius: 8px;
    text-align: center;
    box-shadow: 0 10px 15px rgba(0, 0, 0, 0.12);
    border: 1px solid #b91c1c;
  }

  .wm-bottom-text {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.025em;
    margin: 0;
  }
`;
