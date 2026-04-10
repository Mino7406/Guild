package bot;

import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;

import java.awt.Color;

public class Rathalos extends ListenerAdapter {
    
    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getName().equals("몬스터")) {
            
            OptionMapping option = event.getOption("이름");
            if (option == null) {
                event.reply("몬스터 이름을 입력해주세요!").queue();
                return;
            }
            
            String monsterName = option.getAsString();

            EmbedBuilder embed = new EmbedBuilder();
            embed.setColor(new Color(184, 56, 56));
            
            // 1. 타이틀 설정 (이전의 Author 대신 Title을 씁니다)
             embed.setDescription("# " + monsterName + "\n"); 

            // 2. 우측 상단 몬스터 아이콘 (확실하게 작동하는 위키 이미지 URL로 변경)
            String iconUrl = "https://i.namu.wiki/i/W9suJffGvrwZFVhW5RpXcWL8__p2E-bulZI4k3IHOZbNdE4-iNnABnt9PukrifEve4Byen76TEkNHuHy8-r8MRKRMKpNlDxfs0A0z4FRkynteZWvoRysPI9YeY_IHGf9NzZuGalrD9LGE0BQlGT9Vg.webp";
            embed.setThumbnail(iconUrl);


            // 3. 상태이상 및 함정 내성
            embed.addField("상태이상", "독 (⭐)\n수면 (⭐)\n마비 (⭐)\n폭파 (⭐)\n기절 (⭐)\n\u200B", true);
            embed.addField("함정 여부", "구멍함정 (⭕)\n마비덫 (⭕)\n\u200B", true);

            

            // 4. 육질표 
            embed.addField("주요 육질표",
                    "```\n" +
                    "부위   | 절단 | 타격 | 탄 \n" +
                    "머리   |  65  |  60  | 45 \n" +
                    "앞다리 |  45  |  40  | 30 \n" +
                    "꼬리   |  50  |  45  | 25 \n" +
                    "```\n\u200B", false);

            // 5. 소재 드랍률
            embed.addField("주요 소재 드랍률",
                    "**홍옥**: 갈무리 2%, 포획 3%, 부위파괴(머리) 1%\n" +
                    "**역린**: 갈무리 10%, 유실물 12%", false);

            event.replyEmbeds(embed.build()).queue();
        }
    }
}