import { UserEntity } from '../../database/entities';

export class UserResponseDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;

  // IMPORTANT: passwordHash is intentionally excluded from response

  static from(entity: UserEntity): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = entity.id;
    dto.email = entity.email;
    dto.name = entity.name;
    dto.phone = entity.phone;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    // Note: passwordHash is NOT included in the response
    return dto;
  }

  static fromArray(entities: UserEntity[]): UserResponseDto[] {
    return entities.map(entity => UserResponseDto.from(entity));
  }
}
