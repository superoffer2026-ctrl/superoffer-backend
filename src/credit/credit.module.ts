import { Module } from '@nestjs/common';
import { FormsModule } from '../forms/forms.module';
import { BureauCredentialController } from './bureau-credential.controller';
import { BureauCredentialService } from './bureau-credential.service';
import { OrganizationCreditController, StudentCreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { FileSecretStore } from './secret-store';
import { StubBureauProvider } from './stub-bureau.provider';

/**
 * The co-applicant, the consent that permits a credit look-up, and the look-up
 * itself.
 *
 * The provider is bound here rather than in the service, so swapping the stub
 * for a real connector is one line and touches nothing else.
 */
@Module({
  imports: [FormsModule],
  controllers: [StudentCreditController, OrganizationCreditController, BureauCredentialController],
  providers: [CreditService, StubBureauProvider, BureauCredentialService, FileSecretStore],
  exports: [CreditService]
})
export class CreditModule {}
