import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { UserEntity } from '../database/entities';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  /**
   * Get all users (not deleted)
   * IMPORTANT: passwordHash is excluded in the DTO layer, not here
   */
  async findAll(): Promise<UserEntity[]> {
    return this.userRepository.find({
      where: {
        deletedAt: IsNull(),
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  /**
   * Get a single user by ID
   */
  async findOne(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: {
        id,
        deletedAt: IsNull(),
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  /**
   * Get a user by email
   */
  async findByEmail(email: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: {
        email,
        deletedAt: IsNull(),
      },
    });

    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }

    return user;
  }
}
