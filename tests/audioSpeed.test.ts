import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AUDIO_SPEED,
  SUPPORTED_AUDIO_SPEEDS,
  applyHtmlAudioPlaybackRate,
  formatAudioSpeedLabel,
  normalizeAudioSpeed,
} from '../src/utils/audioSpeed';
import { speechManager } from '../src/utils/speech';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

test('SUPPORTED_AUDIO_SPEEDS matches the 7 universal speed options and 1x default', () => {
  assert.deepEqual([...SUPPORTED_AUDIO_SPEEDS], [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.equal(SUPPORTED_AUDIO_SPEEDS.length, 7);
  assert.equal(DEFAULT_AUDIO_SPEED, 1);
});

test('normalizeAudioSpeed clamps, snaps, parses strings, and recovers safely from invalid values', () => {
  for (const speed of SUPPORTED_AUDIO_SPEEDS) {
    assert.equal(normalizeAudioSpeed(speed), speed);
    assert.equal(normalizeAudioSpeed(String(speed)), speed);
  }

  assert.equal(normalizeAudioSpeed(0.1), 0.5);
  assert.equal(normalizeAudioSpeed(0.49), 0.5);
  assert.equal(normalizeAudioSpeed(2.8), 2);
  assert.equal(normalizeAudioSpeed(1.1), 1);
  assert.equal(normalizeAudioSpeed(1.2), 1.25);
  assert.equal(normalizeAudioSpeed(1.68), 1.75);

  assert.equal(normalizeAudioSpeed(0), 1);
  assert.equal(normalizeAudioSpeed(-1.5), 1);
  assert.equal(normalizeAudioSpeed(NaN), 1);
  assert.equal(normalizeAudioSpeed(Infinity), 1);
  assert.equal(normalizeAudioSpeed(null), 1);
  assert.equal(normalizeAudioSpeed(undefined), 1);
  assert.equal(normalizeAudioSpeed('invalid'), 1);
});

test('formatAudioSpeedLabel renders compact labels and optional Normal indicator', () => {
  assert.equal(formatAudioSpeedLabel(0.5), '0.5×');
  assert.equal(formatAudioSpeedLabel(0.75), '0.75×');
  assert.equal(formatAudioSpeedLabel(1), '1×');
  assert.equal(formatAudioSpeedLabel(1.25), '1.25×');
  assert.equal(formatAudioSpeedLabel(1.5), '1.5×');
  assert.equal(formatAudioSpeedLabel(1.75), '1.75×');
  assert.equal(formatAudioSpeedLabel(2), '2×');

  assert.equal(formatAudioSpeedLabel(1, { withNormal: true }), '1× (Normal)');
  assert.equal(formatAudioSpeedLabel(1.5, { withNormal: true }), '1.5×');
});

test('applyHtmlAudioPlaybackRate mutates target safely and handles throwing playbackRate setters', () => {
  assert.equal(applyHtmlAudioPlaybackRate(null, 1.5), false);
  assert.equal(applyHtmlAudioPlaybackRate(undefined, 1.5), false);

  const goodAudio = { playbackRate: 1 };
  assert.equal(applyHtmlAudioPlaybackRate(goodAudio, 1.75), true);
  assert.equal(goodAudio.playbackRate, 1.75);

  let fallbackApplied = 0;
  const strictAudio = {
    get playbackRate() {
      return fallbackApplied;
    },
    set playbackRate(val: number) {
      if (val !== 1) {
        throw new Error('RangeError simulation');
      }
      fallbackApplied = val;
    },
  };
  assert.equal(applyHtmlAudioPlaybackRate(strictAudio, 2), false);
  assert.equal(fallbackApplied, 1);
});

test('speechManager updates active HTMLAudioElement playbackRate live and preserves across pause/resume/stop', async () => {
  const prevAudio = (globalThis as any).Audio;
  const prevWindow = (globalThis as any).window;
  const prevFetch = (globalThis as any).fetch;
  const prevCreateObjectUrl = URL.createObjectURL;
  const prevRevokeObjectUrl = URL.revokeObjectURL;

  const createdAudios: any[] = [];

  class MockAudio {
    public src: string;
    public playbackRate = 1;
    public paused = false;
    public onended: (() => void) | null = null;
    public onerror: (() => void) | null = null;

    constructor(url: string) {
      this.src = url;
      createdAudios.push(this);
    }

    play() {
      this.paused = false;
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
    }
  }

  try {
    (globalThis as any).Audio = MockAudio;
    (globalThis as any).window = {
      speechSynthesis: {
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        getVoices: () => [],
        speaking: false,
      },
    };
    URL.createObjectURL = () => 'blob:mock-audio-1';
    URL.revokeObjectURL = () => {};

    // Tiny valid base64 payload (> 0 bytes)
    const sampleBase64 = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ').toString('base64');
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => ({
        success: true,
        audioBase64: sampleBase64,
      }),
    });

    speechManager.setRate(1.25);
    assert.equal(speechManager.getRate(), 1.25);

    let started = false;
    let ended = false;
    speechManager.speak({
      text: 'Welcome to Charaiva architectural guide.',
      languageCode: 'en-US',
      language: 'English',
      onStart: () => {
        started = true;
      },
      onEnd: () => {
        ended = true;
      },
    });

    await flushMicrotasks();

    assert.equal(started, true);
    assert.equal(ended, false);
    assert.equal(createdAudios.length, 1);
    assert.equal(createdAudios[0].playbackRate, 1.25);
    assert.equal(speechManager.getActiveEngine(), 'html_audio');

    // Live mid-playback speed update without restarting audio
    const liveResult = speechManager.setRate(1.75);
    assert.equal(liveResult.rate, 1.75);
    assert.equal(liveResult.appliedLive, true);
    assert.equal(liveResult.engine, 'html_audio');
    assert.equal(createdAudios.length, 1);
    assert.equal(createdAudios[0].playbackRate, 1.75);

    // Pause + Resume preserves chosen speed
    speechManager.pause();
    assert.equal(createdAudios[0].paused, true);
    speechManager.setRate(0.75);
    speechManager.resume();
    await flushMicrotasks();
    assert.equal(createdAudios[0].paused, false);
    assert.equal(createdAudios[0].playbackRate, 0.75);

    // Complete playback naturally and verify global preference remains after stop()
    createdAudios[0].onended?.();
    await flushMicrotasks();
    assert.equal(ended, true);

    speechManager.stop();
    assert.equal(speechManager.getRate(), 0.75);
    speechManager.setRate(DEFAULT_AUDIO_SPEED);
  } finally {
    speechManager.stop();
    speechManager.setRate(DEFAULT_AUDIO_SPEED);
    (globalThis as any).Audio = prevAudio;
    (globalThis as any).window = prevWindow;
    (globalThis as any).fetch = prevFetch;
    URL.createObjectURL = prevCreateObjectUrl;
    URL.revokeObjectURL = prevRevokeObjectUrl;
  }
});

test('speechManager applies speed updates on subsequent SpeechSynthesis chunks without restarting narration', async () => {
  const prevWindow = (globalThis as any).window;
  const prevUtterance = (globalThis as any).SpeechSynthesisUtterance;
  const prevFetch = (globalThis as any).fetch;

  const spokenUtterances: any[] = [];
  let cancelCount = 0;

  class MockUtterance {
    public text: string;
    public lang = '';
    public rate = 1;
    public pitch = 1;
    public voice: any = null;
    public onstart: (() => void) | null = null;
    public onend: (() => void) | null = null;
    public onerror: ((e: any) => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  }

  try {
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    (globalThis as any).window = {
      speechSynthesis: {
        speaking: false,
        getVoices: () => [{ name: 'Google US English Female', lang: 'en-US' }],
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: () => {
          cancelCount += 1;
        },
        pause: () => {},
        resume: () => {},
        speak: (utt: any) => {
          spokenUtterances.push(utt);
          utt.onstart?.();
        },
      },
    };
    (globalThis as any).fetch = async () => ({
      ok: false,
      json: async () => ({ fallbackToBrowser: true }),
    });

    speechManager.setRate(1);
    const baselineCancelCount = cancelCount;

    // Construct text > 320 chars so splitIntoSpeechChunks emits 2 chunks
    const sentenceA = 'First architectural section describes the sandstone arches and carved lintels in rich historical detail. '.repeat(3).trim();
    const sentenceB = 'Second architectural section explores the hidden courtyard colonnade and acoustics. '.repeat(2).trim();

    let started = false;
    let ended = false;
    speechManager.speak({
      text: `${sentenceA} ${sentenceB}`,
      languageCode: 'en-US',
      language: 'English',
      onStart: () => {
        started = true;
      },
      onEnd: () => {
        ended = true;
      },
    });

    await flushMicrotasks();
    assert.equal(started, true);
    assert.equal(spokenUtterances.length, 1);
    assert.equal(spokenUtterances[0].rate, 1);

    // Update speed during chunk 1: should NOT call speechSynthesis.cancel(), and next chunk gets 1.5x
    const updateRes = speechManager.setRate(1.5);
    assert.equal(updateRes.rate, 1.5);
    assert.equal(updateRes.appliedLive, false);
    assert.equal(updateRes.engine, 'speech_synthesis');
    assert.equal(cancelCount, baselineCancelCount + 1); // +1 was initial speak() -> stop(), no extra cancel on setRate

    spokenUtterances[0].onend?.();
    await flushMicrotasks();

    assert.equal(spokenUtterances.length, 2);
    assert.equal(spokenUtterances[1].rate, 1.5);

    spokenUtterances[1].onend?.();
    await flushMicrotasks();
    assert.equal(ended, true);
  } finally {
    speechManager.stop();
    speechManager.setRate(DEFAULT_AUDIO_SPEED);
    (globalThis as any).window = prevWindow;
    (globalThis as any).SpeechSynthesisUtterance = prevUtterance;
    (globalThis as any).fetch = prevFetch;
  }
});

test('speechManager applies speed to Web Audio AudioBufferSourceNode and updates live', () => {
  const prevWindow = (globalThis as any).window;
  let capturedSource: any = null;

  class MockAudioContext {
    public destination = {};
    decodeAudioData(_buffer: ArrayBuffer, cb: (decoded: any) => void) {
      cb({ duration: 1 });
    }
    createBufferSource() {
      capturedSource = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: () => {},
        start: () => {},
        stop: () => {},
        onended: null as (() => void) | null,
      };
      return capturedSource;
    }
  }

  try {
    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      speechSynthesis: {
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        getVoices: () => [],
        speaking: false,
      },
    };

    speechManager.setRate(2);
    const pcmBase64 = Buffer.from([1, 2, 3, 4]).toString('base64');
    speechManager.playRawAudio(pcmBase64);

    assert.ok(capturedSource, 'Expected AudioBufferSourceNode to be created');
    assert.equal(capturedSource.playbackRate.value, 2);
    assert.equal(speechManager.getActiveEngine(), 'web_audio');

    const liveRes = speechManager.setRate(0.5);
    assert.equal(liveRes.rate, 0.5);
    assert.equal(liveRes.appliedLive, true);
    assert.equal(liveRes.engine, 'web_audio');
    assert.equal(capturedSource.playbackRate.value, 0.5);
  } finally {
    speechManager.stop();
    speechManager.setRate(DEFAULT_AUDIO_SPEED);
    (globalThis as any).window = prevWindow;
  }
});
