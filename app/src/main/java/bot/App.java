package bot;

import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;

public class App {
    public static void main(String[] args) {
        // ⚠️ 경고: 여기에 본인의 실제 봇 토큰을 넣으세요! (유출 주의)
        String token = "MTQ5MDkzMzY5MDA2OTY4MDIzOA.GaU4ZA.KKbq15i-UxPrE_Ilb1K1QGnYt2mOLkxRDkkSY4"; 
        
        // 디스코드 서버 ID
        String guildId = "1282704020619661393"; 

        try {
            JDA jda = JDABuilder.createDefault(token)
                    .enableIntents(GatewayIntent.MESSAGE_CONTENT)
                    .addEventListeners(new Monster())
                    .build();

            jda.awaitReady(); 

            // 💡 끝부분의 (..., true, true) 중 마지막 true가 "자동완성(Autocomplete) 켜기" 입니다.
            jda.getGuildById(guildId).updateCommands().addCommands(
                Commands.slash("몬스터", "해당 몬스터의 정보를 확인합니다. (⚠️Beta - 현재 9성몹만 검색 가능합니다.) ")
                        .addOption(OptionType.STRING, "이름", "검색할 몬스터의 이름을 입력하세요. [ ※ 별명이나 줄임말로도 검색 가능합니다. ]", true, true)
            ).queue();
            
            System.out.println("봇이 성공적으로 실행되었고, 테스트 서버에 명령어가 즉시 등록되었습니다!");

        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}