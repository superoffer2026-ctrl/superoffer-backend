import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { LocalMediaStorage } from './media.storage';

/**
 * Image storage, behind one interface.
 *
 * Swapping disk for S3 means binding a different implementation here; no caller
 * changes, because none of them knows what a reference means.
 */
@Module({
  controllers: [MediaController],
  providers: [LocalMediaStorage],
  exports: [LocalMediaStorage]
})
export class MediaModule {}
