export const VERSION: string;
export const MAX_MESSAGE_SIZE: number;
export function createChromeMessageFrame(message: string | object): Buffer;
export function sendChromeMessage(message: string | object): void;
export function getSocketDir(): string;
export function getSecureSocketPath(): string;
export function getAllSocketPaths(): string[];
export function runChromeNativeHost(): Promise<void>;
export class ChromeNativeHost {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<boolean>;
  getClientCount(): Promise<number>;
  handleMessage(messageJson: string): Promise<void>;
}
export class ChromeMessageReader {
  constructor(input?: NodeJS.ReadableStream);
  read(): Promise<string | null>;
}
