import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import * as bodyParser from "body-parser";

/**
 * Middleware to increase the body size limit for review upload endpoint.
 * Default Express JSON body parser limit is 100kb, which is too small for
 * base64-encoded images. This increases it to 15mb.
 *
 * Note: NestJS already scopes this middleware to the route via
 * .forRoutes(ReviewUploadController), so no path check is needed here.
 */
@Injectable()
export class ReviewUploadBodyParserMiddleware implements NestMiddleware {
  // JSON body parser with 15mb limit (base64 increases size by ~33%)
  private jsonParser = bodyParser.json({ limit: "15mb" });

  use(req: Request, res: Response, next: NextFunction) {
    this.jsonParser(req, res, next);
  }
}
