
import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';

@Injectable()
export class TestUnusedService {
  test() {
    console.log('test');
  }
}

