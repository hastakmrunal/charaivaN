# Charaiva Firestore Security Specification

## 1. Data Invariants
1. User PII (`email`, `name`) is strictly isolated inside `/users/{userId}/private/profile` and is never readable or listable by any user other than the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. User guide preferences and onboarding progress reside inside `/users/{userId}/preferences/guide`, strictly accessible only to the verified owner.
3. All writes enforce strict field allowlisting (`keys().hasAll(...) && keys().hasOnly(...)`) on creation and `affectedKeys().hasOnly(...)` on update, plus server timestamp enforcement (`request.time`), preventing shadow fields, spoofed `uid` ownership, or backdated timestamps.
4. User travel journal logs reside exclusively at `/users/{userId}/journalEntries/{journalId}`, strictly scoped to `request.auth.uid == userId && request.auth.token.email_verified == true` and `resource.data.userId == request.auth.uid` for both `get` and `list` queries.
5. User AI Guide conversations and messages reside exclusively at `/users/{userId}/aiConversations/{conversationId}` and `/users/{userId}/aiConversations/{conversationId}/messages/{messageId}`, strictly scoped to verified owners with immutable ownership/IDs, bounded message counts/sizes, and server timestamps.
6. No cross-user collection `list` permissions exist anywhere in the ruleset; default-deny catch-all (`/{document=**}`) blocks all unlisted paths.

## 2. Adversarial "Dirty Dozen" Payloads (All Must Return PERMISSION_DENIED)
1. Unauthenticated read/list of `/users/userA/private/profile`, `/users/userA/journalEntries`, or `/users/userA/aiConversations` (`request.auth == null`).
2. Cross-user read/list of `/users/userA/journalEntries` or `/users/userA/aiConversations` while authenticated as `userB`.
3. Cross-user write/delete to `/users/userA/journalEntries/j1` or `/users/userA/aiConversations/c1` while authenticated as `userB`.
4. Spoofed `uid` or `userId` inside create payload (`userId: "userB"` under `/users/userA/journalEntries/j1` or `/users/userA/aiConversations/c1`).
5. Unverified email write (`request.auth.token.email_verified == false`) attempting to create profile, journal entry, or AI conversation.
6. Shadow field injection on profile/journal/chat create (`extraAdminFlag: true` or `role: "admin"`).
7. Shadow field injection on preferences, journal, or conversation update (`isPremium: true` or mutating `userId`/`journalId`/`conversationId`).
8. Oversized string resource-exhaustion write (`placeName` > 160 chars, `notes` > 2000 chars, chat `text` > 12000 chars, or base64 image in `imageUrl` > 600 chars).
9. Invalid `userId`, `journalId`, `conversationId`, or `messageId` path variable (`userA$bad!` failing `^[a-zA-Z0-9_\-]+$`).
10. Client-forged timestamp on create/update (`updatedAt: Timestamp.fromDate(new Date(0))` instead of `request.time`).
11. Mutating immutable `createdAt`, `journalId`, `conversationId`, or `userId` during update.
12. Invalid `topics` map, invalid chat `sender` role, or unbounded/non-string `tags` / `keyFacts` arrays (> 12 items or non-string first element).
