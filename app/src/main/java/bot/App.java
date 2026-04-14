package bot;

import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;

public class App {
    public static void main(String[] args) {
        // ⚠️ 경고: 디스코드 봇 토큰이 노출되었습니다! 가급적 디스코드 개발자 포털에서 토큰을 재발급(Reset Token) 받는 것을 권장합니다.
        String token = "MTQ5MDkzMzY5MDA2OTY4MDIzOA.GaU4ZA.KKbq15i-UxPrE_Ilb1K1QGnYt2mOLkxRDkkSY4"; // 새로 발급받으면 이곳을 수정하세요!
        
        // 기존 디스코드 서버 ID (테스트 서버에 남아있는 중복 명령어를 지우기 위해 임시 유지)
        String guildId = "1282704020619661393"; 

        try {
            JDA jda = JDABuilder.createDefault(token)
                    .enableIntents(GatewayIntent.MESSAGE_CONTENT)
                    .addEventListeners(new Monster())
                    .build();

            jda.awaitReady(); 

            // 💡 1. 기존 테스트 서버에 국한되어 있던 명령어 지우기 (명령어 중복 2개 뜨는 현상 방지)
            if (jda.getGuildById(guildId) != null) {
                jda.getGuildById(guildId).updateCommands().queue();
            }

            // 💡 2. 전역(모든 디스코드 서버)에 명령어 등록하기! (jda.updateCommands() 사용)
            jda.updateCommands().addCommands(
                Commands.slash("몬스터", "해당 몬스터의 정보를 확인합니다. (⚠️Beta - 현재 9성몹만 검색 가능합니다.) ")
                        .addOption(OptionType.STRING, "이름", "검색할 몬스터의 이름을 입력하세요. [ ※ 별명이나 줄임말로도 검색 가능합니다. ]", true, true)
            ).queue();
            
            System.out.println("✅ 봇이 성공적으로 실행되었습니다!");
            System.out.println("✅ 기존 테스트 서버의 명령어는 삭제되었으며, '전역(모든 서버)'으로 명령어 등록 요청이 전송되었습니다.");
            System.out.println("⏳ [안내] 전역 명령어는 디스코드 시스템 전체에 동기화되는 데 최대 1시간 정도 걸릴 수 있습니다.");

        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}