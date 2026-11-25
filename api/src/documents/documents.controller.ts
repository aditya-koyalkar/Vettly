import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  createDocumentSchema,
  listDocumentsSchema,
  searchDocumentsSchema,
  type CreateDocument,
  type ListDocuments,
  type SearchDocuments,
} from './documents.schemas.js';
import { DocumentsService } from './documents.service.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const id = z.uuid();

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  create(
    @CurrentUser('id') userId: string,
    @Body({ schema: createDocumentSchema }) body: CreateDocument,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file?: Express.Multer.File,
  ) {
    return this.documents.create(userId, body, file);
  }

  @Get()
  list(@CurrentUser('id') userId: string, @Query({ schema: listDocumentsSchema }) query: ListDocuments) {
    return this.documents.list(userId, query.kind);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@CurrentUser('id') userId: string, @Body({ schema: searchDocumentsSchema }) body: SearchDocuments) {
    return this.documents.search(userId, body);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id', { schema: id }) documentId: string) {
    return this.documents.get(userId, documentId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('id') userId: string, @Param('id', { schema: id }) documentId: string) {
    return this.documents.remove(userId, documentId);
  }
}
