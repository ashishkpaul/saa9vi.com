import { Controller, Post, Req, Res, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable } from "stream";
import {
  Allow,
  AssetService,
  Logger,
  Permission,
  RequestContextService,
  SessionService,
} from "@vendure/core";

const loggerCtx = "ReviewUploadController";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/**
 * REST endpoint for uploading review images.
 * Uses JSON body with base64-encoded file data to avoid
 * Apollo Server's multipart field order enforcement.
 *
 * Usage:
 * POST /reviews-api/upload-asset
 * Content-Type: application/json
 * Body: { file: { data: string (base64), filename: string, mimetype: string } }
 */
@Controller("reviews-api")
export class ReviewUploadController {
  constructor(
    private assetService: AssetService,
    private requestContextService: RequestContextService,
    private sessionService: SessionService,
  ) {}

  @Post("upload-asset")
  @Allow(Permission.Authenticated)
  async uploadAsset(@Req() req: Request, @Res() res: Response) {
    try {
      const body = req.body;
      const { file } = body;

      if (!file?.data) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: "No file data provided",
        });
      }

      // Validate mime type
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: `Invalid file type: ${file.mimetype}. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
        });
      }

      // Decode base64 data
      const buffer = Buffer.from(file.data, "base64");

      // Check file size
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        });
      }

      Logger.info(
        `Upload request: ${file.filename} (${file.mimetype}, ${buffer.length} bytes)`,
        loggerCtx,
      );

      const authHeader = req.get("Authorization");
      const bearerToken = authHeader?.match(/^bearer\s+(.+)$/i)?.[1];
      const sessionToken = (req as any).session?.token ?? bearerToken;
      const session = sessionToken
        ? await this.sessionService.getSessionFromToken(sessionToken)
        : undefined;

      const ctx = await this.requestContextService.fromRequest(
        req,
        undefined,
        undefined,
        session,
      );
      const activeUserId = ctx.activeUserId;

      if (!activeUserId) {
        Logger.warn(
          `Upload rejected: No active user session. Session token present=${Boolean(sessionToken)}`,
          loggerCtx,
        );
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: "You must be logged in to upload review images",
        });
      }

      // Vendure's AssetService.create() expects input.file to have:
      // createReadStream, filename, mimetype
      const fileInput = {
        file: {
          filename: file.filename,
          mimetype: file.mimetype,
          createReadStream: () => {
            const stream = new Readable();
            stream.push(buffer);
            stream.push(null);
            return stream;
          },
        },
        tags: ["review"],
      };

      Logger.info(`Creating asset for user ${activeUserId}`, loggerCtx);

      // Create asset using AssetService
      const result = await this.assetService.create(ctx, fileInput);

      // Check if result is an error
      if (!("id" in result)) {
        Logger.error(
          `Failed to create asset: ${JSON.stringify(result)}`,
          loggerCtx,
        );
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: result.errorCode || "Failed to process image",
        });
      }

      Logger.info(`Asset created: ${result.id}`, loggerCtx);

      return res.status(HttpStatus.OK).json({
        assetId: result.id,
        preview: result.preview,
        source: result.source,
      });
    } catch (error) {
      Logger.error(`Upload failed: ${error?.message}`, loggerCtx, error?.stack);

      if (error?.message?.includes("file type")) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: error.message,
        });
      }

      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        error: `Upload failed: ${error?.message}`,
      });
    }
  }
}
