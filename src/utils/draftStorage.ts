import { ApplicationFormData } from '../types';

export const DRAFT_STORAGE_KEY = 'kiip_form_draft_v1';

export interface SavedDraftPayload {
  formData: ApplicationFormData;
  timestamp: string; // ISO string
  summaryName?: string;
  summaryVisa?: string;
}

/**
 * Checks if formData contains user-entered or extracted data worth saving
 */
export function isFormDataWorthSaving(data: ApplicationFormData): boolean {
  if (!data) return false;
  return Boolean(
    (data.name && data.name.trim() && data.name.trim() !== '0000 0000') ||
    (data.regNumber1 && data.regNumber1.trim() && data.regNumber1.trim() !== '000000') ||
    (data.address && data.address.trim()) ||
    (data.phone && data.phone.trim()) ||
    (data.mobile && data.mobile.trim()) ||
    (data.examNumber && data.examNumber.trim() && data.examNumber.trim() !== '0000000000000') ||
    (data.round && data.round.trim()) ||
    (data.grade && data.grade.trim()) ||
    (data.socinetId && data.socinetId.trim()) ||
    (data.passportNo && data.passportNo.trim())
  );
}

/**
 * Saves current formData to localStorage
 */
export function saveFormDraft(data: ApplicationFormData): { success: boolean; timestamp: string } {
  try {
    const timestamp = new Date().toISOString();
    const payload: SavedDraftPayload = {
      formData: data,
      timestamp,
      summaryName: data.name || data.applicantName || '',
      summaryVisa: data.visaStatus || 'E-9-1',
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
    
    // Dispatch custom event so listeners (e.g. Header button) update reactively
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kiip:draft-saved', { detail: payload }));
    }
    return { success: true, timestamp };
  } catch (err) {
    console.warn('Failed to save draft to localStorage:', err);
    return { success: false, timestamp: '' };
  }
}

/**
 * Retrieves the saved draft from localStorage
 */
export function getSavedFormDraft(): {
  formData: ApplicationFormData;
  timestamp: string;
  formattedDate: string;
  summaryName?: string;
  summaryVisa?: string;
} | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: SavedDraftPayload = JSON.parse(raw);
    if (!parsed || !parsed.formData) return null;

    const dateObj = new Date(parsed.timestamp);
    const formattedDate = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleString('km-KH', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : parsed.timestamp;

    return {
      formData: parsed.formData,
      timestamp: parsed.timestamp,
      formattedDate,
      summaryName: parsed.summaryName,
      summaryVisa: parsed.summaryVisa,
    };
  } catch (err) {
    console.warn('Failed to retrieve draft from localStorage:', err);
    return null;
  }
}

/**
 * Checks if a valid draft exists
 */
export function hasSavedFormDraft(): boolean {
  try {
    const draft = getSavedFormDraft();
    return Boolean(draft && isFormDataWorthSaving(draft.formData));
  } catch {
    return false;
  }
}

/**
 * Clears the saved draft from localStorage
 */
export function clearSavedFormDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kiip:draft-cleared'));
    }
  } catch (err) {
    console.warn('Failed to clear draft from localStorage:', err);
  }
}
