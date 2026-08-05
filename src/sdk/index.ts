import { TextSDK } from "./text";
import { SpeechSDK } from "./speech";
import { ImageSDK } from "./image";
import { VideoSDK } from "./video";
import { MusicSDK } from "./music";
import { SearchSDK } from "./search";
import { VisionSDK } from "./vision";
import { QuotaSDK } from "./quota";
import { FileSDK } from "./file";
import { Client } from "./client";
import type { MiniMaxSDKOptions } from "./types";

export class MiniMaxSDK extends Client {
  readonly text: TextSDK;
  readonly speech: SpeechSDK;
  readonly image: ImageSDK;
  readonly video: VideoSDK;
  readonly music: MusicSDK;
  readonly search: SearchSDK;
  readonly vision: VisionSDK;
  readonly quota: QuotaSDK;
  readonly file: FileSDK;

  constructor(options: MiniMaxSDKOptions) {
    super(options);
    this.text = new TextSDK(this.context);
    this.speech = new SpeechSDK(this.context);
    this.image = new ImageSDK(this.context);
    this.video = new VideoSDK(this.context);
    this.music = new MusicSDK(this.context);
    this.search = new SearchSDK(this.context);
    this.vision = new VisionSDK(this.context);
    this.quota = new QuotaSDK(this.context);
    this.file = new FileSDK(this.context);
  }
}
