import * as native from 'libwaimedia.so';

export interface Command {
  op: string;
  token?: number;
  surface?: string;
  url?: string;
  ca?: string;
  cookies?: string;
  position?: number;
}
export interface Status {
  token?: number;
  stale?: boolean;
  ready?: boolean;
  position?: number;
  duration?: number;
  playing?: boolean;
  waiting?: boolean;
  complete?: boolean;
  error?: string;
  warning?: string;
  decoder?: string;
  width?: number;
  height?: number;
  subtitle?: string;
}
export async function command(request: Command): Promise<Status> {
  return JSON.parse(await native.invoke(JSON.stringify(request))) as Status;
}

export class WebBridge {
  openVideo: (value: string) => void;
  constructor(open: (value: string) => void) { this.openVideo = open; }
  open(value: string): void { this.openVideo(value); }
}
export interface WebVideoRequest {
  url: string;
  page: string;
  position: number;
}
