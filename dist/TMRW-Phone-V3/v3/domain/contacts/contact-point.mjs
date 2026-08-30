import { requireText } from '../identity/identity-record.mjs';

export function contactPointId(scope, ownerAccountId, phoneNumberId) { return `contact-point:${scope.storyId}:${scope.branchId}:${requireText(ownerAccountId, 'ownerAccountId')}:${requireText(phoneNumberId, 'phoneNumberId')}`; }
