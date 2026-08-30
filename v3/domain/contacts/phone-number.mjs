import { requireText } from '../identity/identity-record.mjs';

export function normalizePhoneNumber(value) {
  const text = requireText(value, 'phone number').replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]{3,20}$/.test(text)) throw new TypeError('Phone number must contain 3–20 digits and an optional leading +');
  return text;
}

export function phoneNumberId(scope, viewerAccountId, number) {
  return `phone-number:${scope.storyId}:${scope.branchId}:${requireText(viewerAccountId, 'viewerAccountId')}:${encodeURIComponent(normalizePhoneNumber(number))}`;
}
