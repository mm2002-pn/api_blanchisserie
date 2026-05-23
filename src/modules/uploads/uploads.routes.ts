import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { BadRequestError, UnauthorizedError } from '../../utils/errors.js';
import {
  avatarUpload,
  buildPublicUrl,
  linenTypeImageUpload,
  photoUpload,
  signatureUpload,
} from './uploads.middleware.js';

export const uploadsRouter = Router();
uploadsRouter.use(authMiddleware);

function fileResponse(
  file: Express.Multer.File,
  subdir: 'photos' | 'signatures' | 'avatars' | 'linen-types',
) {
  return {
    url: buildPublicUrl(subdir, file.filename),
    filename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  };
}

/** POST /uploads/photos — multi (collecte / livraison / production), max 10 */
uploadsRouter.post(
  '/photos',
  photoUpload.array('files', 10),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new BadRequestError('No files uploaded (field "files")');
    res.status(201).json({ files: files.map((f) => fileResponse(f, 'photos')) });
  }),
);

/** POST /uploads/signatures — un seul fichier */
uploadsRouter.post(
  '/signatures',
  signatureUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const file = req.file;
    if (!file) throw new BadRequestError('No file uploaded (field "file")');
    res.status(201).json(fileResponse(file, 'signatures'));
  }),
);

/** POST /uploads/avatars — photo de profil utilisateur */
uploadsRouter.post(
  '/avatars',
  avatarUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    const file = req.file;
    if (!file) throw new BadRequestError('No file uploaded (field "file")');
    res.status(201).json(fileResponse(file, 'avatars'));
  }),
);

/** POST /uploads/linen-types — image de catalogue article (admin/manager). */
uploadsRouter.post(
  '/linen-types',
  linenTypeImageUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError();
    if (!['admin', 'manager'].includes(req.user.role)) {
      throw new UnauthorizedError('Only admin/manager can upload linen images');
    }
    const file = req.file;
    if (!file) throw new BadRequestError('No file uploaded (field "file")');
    res.status(201).json(fileResponse(file, 'linen-types'));
  }),
);
