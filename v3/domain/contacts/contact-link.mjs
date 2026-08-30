import { requireText } from '../identity/identity-record.mjs';

export function contactLinkId(scope, ownerAccountId, phoneNumberId) { return `contact-link:${scope.storyId}:${scope.branchId}:${requireText(ownerAccountId, 'ownerAccountId')}:${requireText(phoneNumberId, 'phoneNumberId')}`; }

export function normalizeSavedName(value) { return requireText(value, 'saved contact name').slice(0, 120); }
