import { Module } from '@nestjs/common';
import { FormsModule } from '../forms/forms.module';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

@Module({
  imports: [FormsModule],
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService]
})
export class ReferenceModule {}
