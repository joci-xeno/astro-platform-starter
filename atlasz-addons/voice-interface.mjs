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
    state:(stt&&tts)?"CONNECTED_UNTESTED":"PLACEHOLDER_UNCONNECTED",
    live:false, tested:false
  });
  return {
    status,
    async transcribe(input){if(!stt?.transcribe) throw new Error("VOICE_STT_UNAVAILABLE"); return stt.transcribe(input);},
    async speak(text){if(!tts?.speak) throw new Error("VOICE_TTS_UNAVAILABLE"); return tts.speak(text);}
  };
}
