import { Module } from '@nestjs/common';
import { AdminFormsController, PublicFormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { SchemaValidatorService } from './schema-validator.service';

@Module({
  controllers: [PublicFormsController, AdminFormsController],
  providers: [FormsService, SchemaValidatorService],
  exports: [FormsService, SchemaValidatorService]
})
export class FormsModule {}
