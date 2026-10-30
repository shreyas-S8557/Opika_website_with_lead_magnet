// Stores the finished PDF and returns a link for the email.
// On Vercel: Vercel Blob, in a PUBLIC store (the link in the email must open for the prospect;
// file names are unguessable). Connecting the store to the project is all that's needed: the
// SDK signs in with Vercel's automatic OIDC credentials (BLOB_STORE_ID) or BLOB_READ_WRITE_TOKEN.
// Locally without either: saves to lead-magnet/out/ and returns a file:// link.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const slugify = (s) =>
  String(s || 'review').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'review';

const useBlob = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || process.env.VERCEL);

async function storePDF(buffer, company) {
  const name = `${slugify(company)}-visibility-growth-review-${crypto.randomBytes(8).toString('hex')}.pdf`;
  if (useBlob()) {
    const { put } = require('@vercel/blob');
    try {
      const blob = await put(`reviews/${name}`, buffer, {
        access: 'public',
        contentType: 'application/pdf',
        addRandomSuffix: false,
      });
      return blob.url;
    } catch (e) {
      throw new Error(
        `Couldn't save the PDF to Vercel Blob (${e.message}). Check a Blob store is connected to this project ` +
          `and that it was created with PUBLIC access (the access mode can't be changed later).`
      );
    }
  }
  const dir = path.join(__dirname, '..', 'out');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return 'file://' + file;
}

module.exports = { storePDF, slugify };
