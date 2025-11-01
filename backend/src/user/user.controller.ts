import { Controller, Get, Param } from '@nestjs/common';
import { UserService } from './user.service';
import { UserResponseDto } from './dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * GET /api/users
   * Get all users (for dropdown selection)
   */
  @Get()
  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.userService.findAll();
    return UserResponseDto.fromArray(users);
  }

  /**
   * GET /api/users/:id
   * Get a single user by ID
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    const user = await this.userService.findOne(id);
    return UserResponseDto.from(user);
  }

  /**
   * GET /api/users/email/:email
   * Get a user by email
   */
  @Get('email/:email')
  async findByEmail(@Param('email') email: string): Promise<UserResponseDto> {
    const user = await this.userService.findByEmail(email);
    return UserResponseDto.from(user);
  }
}
