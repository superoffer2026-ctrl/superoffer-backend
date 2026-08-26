import { Module } from '@nestjs/common';
import { AdminFormsController, PublicFormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { OptionSetsService } from './option-sets.service';
import { SchemaValidatorService } from './schema-validator.service';

@Module({
  controllers: [PublicFormsController, AdminFormsController],
  providers: [FormsService, SchemaValidatorService, OptionSetsService],
  exports: [FormsService, SchemaValidatorService, OptionSetsService]
})
export class FormsModule {}
