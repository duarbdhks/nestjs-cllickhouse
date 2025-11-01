#!/bin/bash

# 포트 3000을 사용하는 프로세스 종료
echo "Checking for processes using port 3000..."
PID=$(lsof -ti:3000)

if [ -n "$PID" ]; then
  echo "Killing process $PID using port 3000..."
  kill -9 $PID 2>/dev/null || true
  sleep 1
fi

# NestJS 앱 시작
echo "Starting NestJS application..."
npm run start:dev