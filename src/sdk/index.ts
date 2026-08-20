import { TextSDK } from "./text";
import { SpeechSDK } from "./speech";
import { ImageSDK } from "./image";
import { VideoSDK } from "./video";
import { SearchSDK } from "./search";
import { VisionSDK } from "./vision";
import { QuotaSDK } from "./quota";
import { FileSDK } from "./file";
import { Client } from "./client";
import { MiniMaxSDKOptions } from "./types";

export class MiniMaxSDK extends Client {
  readonly text: TextSDK;
  readonly speech: SpeechSDK;
  readonly image: ImageSDK;
  readonly video: VideoSDK;
  readonly search: SearchSDK;
  readonly vision: VisionSDK;
  readonly quota: QuotaSDK;
  readonly file: FileSDK;

  constructor(options: MiniMaxSDKOptions) {
    super(options);
    this.text = new TextSDK(options);
    this.speech = new SpeechSDK(options);
    this.image = new ImageSDK(options);
    this.video = new VideoSDK(options);
    this.search = new SearchSDK(options);
    this.vision = new VisionSDK(options);
    this.quota = new QuotaSDK(options);
    this.file = new FileSDK(options);
  }
}
