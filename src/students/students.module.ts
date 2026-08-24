import { Module } from '@nestjs/common';
import { FormsModule } from '../forms/forms.module';
import { OffersModule } from '../offers/offers.module';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';

@Module({
  imports: [OffersModule, FormsModule],
  providers: [StudentsService],
  controllers: [StudentsController],
  exports: [StudentsService]
})
export class StudentsModule {}
