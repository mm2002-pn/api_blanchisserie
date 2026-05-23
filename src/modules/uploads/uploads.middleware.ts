import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../utils/errors.js';

/**
 * Stockage disque local. En prod, brancher S3/MinIO via @aws-sdk/client-s3
 * en gardant la même surface (renvoyer { url, filename, size, mimetype }).
 *
 * Sous-dossiers : photos/, signatures/, avatars/.
 */

const SUBDIRS = ['photos', 'signatures', 'avatars', 'linen-types'] as const;
type Subdir = (typeof SUBDIRS)[number];

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

ensureDir(env.UPLOAD_DIR);
for (const sub of SUBDIRS) ensureDir(path.join(env.UPLOAD_DIR, sub));

const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function makeStorage(subdir: Subdir) {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(env.UPLOAD_DIR, subdir)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${nanoid(10)}${ext}`);
    },
  });
}

function imageOnly(
  _req: unknown,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  if (!IMAGE_MIME.has(file.mimetype)) {
    return cb(new BadRequestError(`Mime type '${file.mimetype}' not allowed`));
  }
  cb(null, true);
}

export const photoUpload = multer({
  storage: makeStorage('photos'),
  fileFilter: imageOnly,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
});

export const signatureUpload = multer({
  storage: makeStorage('signatures'),
  fileFilter: imageOnly,
  limits: { fileSize: 1 * 1024 * 1024, files: 1 }, // 1 MB max pour une signature
});

export const avatarUpload = multer({
  storage: makeStorage('avatars'),
  fileFilter: imageOnly,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

export const linenTypeImageUpload = multer({
  storage: makeStorage('linen-types'),
  fileFilter: imageOnly,
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
});

export function buildPublicUrl(subdir: Subdir, filename: string) {
  return `/uploads/${subdir}/${filename}`;
}
