// ATLASZ voice interface capability.
// Provider-neutral: no microphone, STT or TTS provider is reported LIVE until attached and tested.
export const VOICE_CAPABILITY = Object.freeze({
  id:"voice-interface", label:"Voice Interface", version:"1.0.0",
  features:["speech-to-text","text-to-speech","master-conversation","approval-gate"],
  ownerApprovalCannotBeBypassed:true
});
export function createVoiceInterface({stt=null,tts=null}={}){
  const status=()=>({
    ...VOICE_CAPABILITY,
    stt:stt?.name||null, tts:tts?.name||null,
    state:(stt?.tested&&tts?.tested)?"LIVE":(stt&&tts)?"CONNECTED_UNTESTED":"PLACEHOLDER_UNCONNECTED",
    live:Boolean(stt?.tested&&tts?.tested), tested:Boolean(stt?.tested&&tts?.tested)
  });
  return {
    status,
    async transcribe(input){if(!stt?.transcribe) throw new Error("VOICE_STT_UNAVAILABLE");if(!stt?.tested)throw new Error("VOICE_STT_UNTESTED");return stt.transcribe(input);},
    async speak(text){if(!tts?.speak) throw new Error("VOICE_TTS_UNAVAILABLE");if(!tts?.tested)throw new Error("VOICE_TTS_UNTESTED");return tts.speak(text);}
  };
}
