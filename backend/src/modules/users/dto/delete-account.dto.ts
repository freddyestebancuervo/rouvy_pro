import { Equals, IsBoolean } from 'class-validator';

/** `DELETE /users/me` exige `confirm: true` explícito en el body — doble
 * confirmación porque es destructivo (spec 1.2). */
export class DeleteAccountDto {
  @IsBoolean()
  @Equals(true, { message: 'Confirmá el borrado con "confirm": true.' })
  confirm!: boolean;
}
