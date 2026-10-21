import type { StudyProfile } from "@/lib/study/agent";

export const RECIPIENT_STIMULUS_VERSION = "birthday-friend-a-images-v5";

export const RECIPIENT_STORY = [
  "당신에게는 친구 A라는 친구가 있습니다.",
  "당신과 친구 A는 몇 년 전부터 알고 지낸 사이로, 평소 연락하거나 만나서 일상에 관한 이야기를 나눕니다. 서로의 관심사와 평소 좋아하는 것에 대해서도 어느 정도 알고 있습니다.",
  "오늘은 당신의 생일입니다. 친구 A는 당신에게 줄 생일 선물을 준비했습니다.",
  "이제 친구 A가 선물을 고른 과정과 최종 선물을 확인하게 됩니다. 각 상황에서 선물과 선물을 고른 방식에 대해 어떻게 생각하는지 답해 주세요.",
  "네 가지 상황은 모두 같은 친구가 같은 생일 선물을 준비하는 상황입니다. 선물을 고르는 방식만 다르다고 생각하고 응답해 주세요.",
].join("\n\n");

// The vignette deliberately supplies no age, gender, hobbies or product tastes.
export const RECIPIENT_SEARCH_PROFILE: StudyProfile = {
  name: "친구 A", hobbies: [], recent_interest: "", preference: "", dislike: "", gift_budget: 50_000,
};
