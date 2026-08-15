-- Expo push tokens for native app installs (iOS/Android). Native counterpart to
-- PushSubscription (browser/PWA VAPID). Additive only (rule #7).

CREATE TABLE "ExpoPushToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "platform"  TEXT,
  "appType"   TEXT,
  "deviceId"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpoPushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpoPushToken_token_key" ON "ExpoPushToken"("token");
CREATE INDEX "ExpoPushToken_userId_idx" ON "ExpoPushToken"("userId");

ALTER TABLE "ExpoPushToken" ADD CONSTRAINT "ExpoPushToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
