import { api, call } from "@omagari/contract";

// 웹이 서버를 부르는 길. 화면은 #18이 올린다.
export const getHealth = () => call({ url: location.origin }, api.health);
