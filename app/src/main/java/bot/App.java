package bot;

import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.requests.GatewayIntent;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;

public class App {
    public static void main(String[] args) {
        // 봇 토큰
        String token = "MTQ5MDkzMzY5MDA2OTY4MDIzOA.GaU4ZA.KKbq15i-UxPrE_Ilb1K1QGnYt2mOLkxRDkkSY4"; 
        
        // 디스코드 서버 ID
        String guildId = "1282704020619661393"; 

        try {
            // 봇 로그인 및 이벤트 리스너(Rathalos) 연결
            JDA jda = JDABuilder.createDefault(token)
                    .enableIntents(GatewayIntent.MESSAGE_CONTENT)
                    .addEventListeners(new Monster()) // <--- 여기가 핵심! 봇에게 Rathalos 파일을 연결해 줍니다.
                    .build();

            // 봇이 완전히 켜질 때까지 대기
            jda.awaitReady(); 

            // 전역이 아닌 '내 서버'에만 명령어를 등록하여 즉시 반영되게 합니다.
            jda.getGuildById(guildId).updateCommands().addCommands(
                Commands.slash("몬스터", "해당 몬스터의 육질표와 소재 드랍률을 확인합니다.")
                        .addOption(OptionType.STRING, "이름", "검색할 몬스터의 이름을 입력하세요.", true)
            ).queue();
            
            System.out.println("봇이 성공적으로 실행되었고, 테스트 서버에 명령어가 즉시 등록되었습니다!");

        } catch (InterruptedException e) {
            e.printStackTrace();
        }
    }
}