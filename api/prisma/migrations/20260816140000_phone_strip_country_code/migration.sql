-- Strip +91 country code prefix from all phone numbers.
-- After this migration phones are stored as 10-digit strings (e.g. "9876543210").
UPDATE "User" SET phone = RIGHT(phone, 10) WHERE phone LIKE '+91%';
