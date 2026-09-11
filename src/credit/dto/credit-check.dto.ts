import { Transform } from 'class-transformer';
import { Equals, IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * The CIBIL form: exactly what the bureau needs to identify a person.
 *
 * Consent is a field rather than an assumption. It is checked here, recorded as
 * a `CreditConsent` row carrying the wording that was shown, and only then
 * restated to SurePass — so what the student agreed to is on record
 * independently of the request that ran off the back of it.
 */
export class CreditCheckDto {
  @IsString()
  @IsNotEmpty({ message: 'Enter the name exactly as printed on their PAN' })
  @Transform(({ value }) => String(value ?? '').trim())
  fullName!: string;

  @Transform(({ value }) => String(value ?? '').trim().toUpperCase())
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'Enter a PAN in the form ABCDE1234F' })
  panNumber!: string;

  /** Ten digits: a +91 or the spacing they typed is not the bureau's business. */
  @Transform(({ value }) => String(value ?? '').replace(/\D/g, '').slice(-10))
  @Matches(/^\d{10}$/, { message: 'Enter their 10-digit mobile number' })
  mobileNumber!: string;

  @Transform(({ value }) => String(value ?? '').toLowerCase())
  @IsIn(['male', 'female'], { message: 'Select their gender' })
  gender!: string;

  @Equals(true, { message: 'Their consent is required before a credit check can run' })
  consent!: boolean;
}
