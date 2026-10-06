-- 0021 — The text in a picture
--
-- Yuri, 2026-10-06, the same evening as 0020: pictures should be read too —
-- "only when it is readable". So the worker runs OCR (tesseract.js, on the
-- worker itself) on saved pictures and keeps the text ONLY when it finds
-- several confident words: a screenshot, a receipt, a business card. A photo
-- with no readable text is recorded `empty`. Nothing describes what a photo
-- shows — that would need a vision model, still not chosen.
--
-- One new kind, `image_text`, beside 0020's two.

alter table attachments drop constraint if exists attachments_text_kind_check;
alter table attachments
  add constraint attachments_text_kind_check
  check (text_kind in ('pdf_text', 'transcript', 'image_text'));
