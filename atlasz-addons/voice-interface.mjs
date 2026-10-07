// ATLASZ voice interface capability.
// Provider-neutral: no microphone, STT or TTS provider is reported LIVE until attached and tested.
export const VOICE_CAPABILITY = Object.freeze({
  id:"voice-interface", label:"Voice Interface", version:"1.0.0",
  features:["speech-to-text","text-to-speech","master-conversation","approval-gate"],
  ownerApprovalCannotBeBypassed:true
});
import {isTested} from "./probe-evidence.mjs";
export function createVoiceInterface({stt=null,tts=null}={}){
  const sttOk=isTested(stt?.tested,stt?.probeEvidence), ttsOk=isTested(tts?.tested,tts?.probeEvidence);
  const status=()=>({
    ...VOICE_CAPABILITY,
    stt:stt?.name||null, tts:tts?.name||null,
    state:(sttOk&&ttsOk)?"LIVE":(stt&&tts)?"CONNECTED_UNTESTED":"PLACEHOLDER_UNCONNECTED",
    live:Boolean(sttOk&&ttsOk), tested:Boolean(sttOk&&ttsOk)
  });
  return {
    status,
    async transcribe(input){if(!stt?.transcribe) throw new Error("VOICE_STT_UNAVAILABLE");if(!sttOk)throw new Error("VOICE_STT_UNTESTED");return stt.transcribe(input);},
    async speak(text){if(!tts?.speak) throw new Error("VOICE_TTS_UNAVAILABLE");if(!ttsOk)throw new Error("VOICE_TTS_UNTESTED");return tts.speak(text);}
  };
}
