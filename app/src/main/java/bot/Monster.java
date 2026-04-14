package bot;

import net.dv8tion.jda.api.entities.MessageEmbed;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.emoji.Emoji;
import net.dv8tion.jda.api.events.interaction.command.CommandAutoCompleteInteractionEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.Command;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.components.ActionRow;
import net.dv8tion.jda.api.interactions.components.buttons.Button;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.awt.Color;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class Monster extends ListenerAdapter {

    private final String[] monsterList = { "레 다우", "우드 투나", "누 이그드라", "진 다하드", "리오레우스", "조 시아", "알슈베르도", "고어 마가라",
            "타마미츠네", "라기아크루스", "셀레기오스", "오메가 플라네테스", "고그마지오스", "고양이 훈련 통 펀처"};

    private final Map<String, List<String>> monsterAliases = new HashMap<>();

    public Monster() {
        monsterAliases.put("레 다우", Arrays.asList("레다우", "레", "레황", "황뢰룡"));
        monsterAliases.put("우드 투나", Arrays.asList("우드", "우드투나", "참치", "나무참치", "나무 참치", "파의룡"));
        monsterAliases.put("누 이그드라", Arrays.asList("누", "누이그드라", "누따끄", "마따끄", "문어", "염옥소"));
        monsterAliases.put("진 다하드", Arrays.asList("찐따", "진다", "진다하드", "찐따하드", "이긴다 소프트", "동봉룡"));
        monsterAliases.put("리오레우스", Arrays.asList("레우스", "리오", "화룡"));
        monsterAliases.put("조 시아", Arrays.asList("바퀴벌레", "조시아", "백열룡"));
        monsterAliases.put("고어 마가라", Arrays.asList("고어마가라", "고어", "마가라", "고아", "흑식룡"));
        monsterAliases.put("알슈베르도", Arrays.asList("알슈", "뉴트리아", "나타", "쇄인룡"));
        monsterAliases.put("타마미츠네", Arrays.asList("타마", "미츠네", "여우", "거품", "포호룡"));
        monsterAliases.put("라기아크루스", Arrays.asList("라기", "라기아", "악어", "수중전", "해룡"));
        monsterAliases.put("셀레기오스", Arrays.asList("셀레기", "제트킥", "째트킥", "셀레", "칼날비늘", "천인룡"));
        monsterAliases.put("오메가 플라네테스", Arrays.asList("오메가", "파판", "파이널판타지", "파이널 판타지", "기계", "메카", "풍뎅이", "메카풍뎅이", "병신"));
        monsterAliases.put("고그마지오스", Arrays.asList("고그마", "고구마", "거극룡", "거극", "파룡포", "기름"));
        monsterAliases.put("고양이 훈련 통 펀처", Arrays.asList("펀처", "고양이 훈련 통", "훈련 통 펀처", "연습장", "연습", "훈련", "수련장", "수련"));
    }

    private String resolveMonsterName(String input) {
        for (String official : monsterList) {
            if (official.equals(input)) return official;
        }
        for (Map.Entry<String, List<String>> entry : monsterAliases.entrySet()) {
            for (String alias : entry.getValue()) {
                if (alias.equals(input)) return entry.getKey();
            }
        }
        return input;
    }

    private String getArrayAsString(JsonObject data, String key) {
        if (!data.has(key)) return "정보가 없습니다.";
        if (data.get(key).isJsonArray()) {
            List<String> lines = new ArrayList<>();
            data.getAsJsonArray(key).forEach(element -> lines.add(element.getAsString()));
            return String.join("\n", lines);
        }
        return data.get(key).getAsString();
    }

    @Override
    public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
        if (event.getName().equals("몬스터") && event.getFocusedOption().getName().equals("이름")) {
            String currentInput = event.getFocusedOption().getValue().trim();
            List<Command.Choice> options = new ArrayList<>();
            for (String officialName : monsterList) {
                boolean isMatch = officialName.contains(currentInput);
                if (!isMatch && monsterAliases.containsKey(officialName)) {
                    for (String alias : monsterAliases.get(officialName)) {
                        if (alias.contains(currentInput)) {
                            isMatch = true;
                            break;
                        }
                    }
                }
                if (isMatch) {
                    options.add(new Command.Choice(officialName, officialName));
                    if (options.size() >= 25) break;
                }
            }
            event.replyChoices(options).queue();
        }
    }

    private JsonObject getMonsterData(String monsterName) {
        try {
            String fileName = monsterName + ".json";
            InputStream is = getClass().getClassLoader().getResourceAsStream(fileName);
            if (is == null) return null;
            return JsonParser.parseReader(new InputStreamReader(is, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    // 💡 스마트 버튼 시스템: 데이터가 있는 탭만 유동적으로 버튼을 생성합니다.
    private List<Button> getTabButtons(String currentTab, String monsterName, JsonObject monsterData) {
        List<Button> buttons = new ArrayList<>();
        
        // "info" 데이터가 있을 때만 기본 정보 버튼 표시 (훈련통펀처 대응)
        if (!currentTab.equals("basic") && monsterData.has("info"))
            buttons.add(Button.secondary("basic_" + monsterName, "기본 정보")
                    .withEmoji(Emoji.fromFormatted("<:Info_4:1492145251941482697>")));
        
        if (!currentTab.equals("hitzone") && monsterData.has("hitzone"))
            buttons.add(Button.primary("hitzone_" + monsterName, "육질 정보")
                    .withEmoji(Emoji.fromFormatted("<:Info_2:1492145248795758602>")));
        
        if (!currentTab.equals("drop") && (monsterData.has("drop") || monsterData.has("drop_low") || monsterData.has("drop_high")))
            buttons.add(Button.success("drop_" + monsterName, "소재 정보")
                    .withEmoji(Emoji.fromFormatted("<:Info_1:1492145247327617185>")));
        
        if (!currentTab.equals("status") && monsterData.has("status"))
            buttons.add(Button.danger("status_" + monsterName, "상태이상 정보")
                    .withEmoji(Emoji.fromFormatted("<:Info_3:1492145250192331015>")));
                    
        return buttons;
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        if (event.getName().equals("몬스터")) {
            OptionMapping option = event.getOption("이름");
            if (option == null) return;
            
            String userInput = option.getAsString().trim();
            String monsterName = resolveMonsterName(userInput);
            JsonObject monsterData = getMonsterData(monsterName);
            
            if (monsterData == null) {
                event.reply("❌ 데이터 없음: `" + userInput + "`").queue();
                return;
            }
            
            // 💡 "info" 데이터가 없으면 육질 탭을 첫 화면으로 띄웁니다! (훈련통펀처 대응)
            if (!monsterData.has("info") && monsterData.has("hitzone")) {
                sendHitzonePage(event, null, monsterName, monsterData, false);
            } else {
                sendBasicPage(event, null, monsterName, monsterData, false);
            }
        }
    }

    @Override
    public void onButtonInteraction(ButtonInteractionEvent event) {
        String[] parts = event.getComponentId().split("_");
        if (parts.length < 2) return;

        String action = parts[0];
        String monsterName = parts[1];
        JsonObject monsterData = getMonsterData(monsterName);
        
        if (monsterData == null) return;

        EmbedBuilder embed = new EmbedBuilder();

        try {
            if (monsterData.has("color")) {
                embed.setColor(Color.decode(monsterData.get("color").getAsString()));
            } else {
                embed.setColor(new Color(255, 255, 255));
            }
        } catch (Exception e) {
            embed.setColor(new Color(255, 255, 255));
        }

        if (monsterData.has("thumbnail")) {
            embed.setThumbnail(monsterData.get("thumbnail").getAsString());
        }

        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String titleText = "# " + icon + monsterName + "\n";

        switch (action) {
            case "basic":
                sendBasicPage(null, event, monsterName, monsterData, true);
                return;

            case "hitzone":
                sendHitzonePage(null, event, monsterName, monsterData, true);
                return;

            case "drop":
            case "dropLow":
            case "dropHigh":
                boolean hasRankInfo = monsterData.has("drop_low");
                String dataKey = "drop"; 
                if (hasRankInfo) {
                    dataKey = action.equals("dropHigh") ? "drop_high" : "drop_low";
                }
                
                List<MessageEmbed> dropEmbeds = splitTextToEmbeds(embed, titleText + "\n" + getArrayAsString(monsterData, dataKey));
                List<ActionRow> rows = new ArrayList<>();
                
                if (hasRankInfo) {
                    rows.add(ActionRow.of(
                        Button.success("dropLow_" + monsterName, "《 하위 》").withEmoji(Emoji.fromFormatted("<:Rank_3:1492424259262222356>")), 
                        Button.success("dropHigh_" + monsterName, "《 상위 》").withEmoji(Emoji.fromFormatted("<:Rank_4:1492424261032214589>"))
                    ));
                }
                
                List<Button> dropButtons = getTabButtons("drop", monsterName, monsterData);
                if (!dropButtons.isEmpty()) rows.add(ActionRow.of(dropButtons));
                
                // 버튼이 아예 없어도 에러나지 않게 방어 코드 적용
                if (rows.isEmpty()) event.editMessageEmbeds(dropEmbeds).setComponents().queue();
                else event.editMessageEmbeds(dropEmbeds).setComponents(rows).queue();
                return;

            case "status":
                List<String> star3 = new ArrayList<>();
                List<String> star2 = new ArrayList<>();
                List<String> star1 = new ArrayList<>();
                List<String> star0 = new ArrayList<>();

                if (monsterData.has("status")) {
                    monsterData.getAsJsonArray("status").forEach(el -> {
                        String originalStr = el.getAsString();
                        String cleanStr = "> " + originalStr.replaceAll("[　\\s]*\\(.*?\\)", "").trim();

                        if (originalStr.contains("⭐⭐⭐")) star3.add(cleanStr);
                        else if (originalStr.contains("⭐⭐")) star2.add(cleanStr);
                        else if (originalStr.contains("⭐")) star1.add(cleanStr);
                        else star0.add(cleanStr);
                    });
                }

                StringBuilder statusDesc = new StringBuilder(titleText + "\n");
                
                if (!star3.isEmpty()) statusDesc.append("**《 ⭐⭐⭐ 매우 유효 》**\n").append(String.join("\n", star3)).append("\n\n");
                if (!star2.isEmpty()) statusDesc.append("**《 ⭐⭐ 유효 》**\n").append(String.join("\n", star2)).append("\n\n");
                if (!star1.isEmpty()) statusDesc.append("**《 ⭐ 조금 유효 》**\n").append(String.join("\n", star1)).append("\n\n");
                if (!star0.isEmpty()) statusDesc.append("**《 ❌ 효과 없음 》**\n").append(String.join("\n", star0)).append("\n\n");

                if (monsterData.has("special_attack")) {
                    statusDesc.append("**《 몬스터의 특수 공격 》**\n");
                    monsterData.getAsJsonArray("special_attack").forEach(el -> {
                        statusDesc.append("> ").append(el.getAsString()).append("\n");
                    });
                    statusDesc.append("\n");
                }
                
                if (monsterData.has("item")) {
                    List<String> validItems = new ArrayList<>();
                    List<String> invalidItems = new ArrayList<>();

                    monsterData.getAsJsonArray("item").forEach(el -> {
                        String originalStr = el.getAsString();
                        String cleanStr = "> " + originalStr.replaceAll("[　\\s]*\\(.*?\\)", "").trim();

                        if (originalStr.contains("⭕")) validItems.add(cleanStr);
                        else if (originalStr.contains("❌")) invalidItems.add(cleanStr);
                        else validItems.add(cleanStr); 
                    });

                    if (!validItems.isEmpty()) {
                        statusDesc.append("**《 ⭕ 유효 아이템 》**\n").append(String.join("\n", validItems)).append("\n\n");
                    }
                    if (!invalidItems.isEmpty()) {
                        statusDesc.append("**《 ❌ 무효 아이템 》**\n").append(String.join("\n", invalidItems)).append("\n\n");
                    }
                }

                List<MessageEmbed> statusEmbeds = splitTextToEmbeds(embed, statusDesc.toString().trim());
                List<Button> statusButtons = getTabButtons("status", monsterName, monsterData);
                
                if (statusButtons.isEmpty()) event.editMessageEmbeds(statusEmbeds).setComponents().queue();
                else event.editMessageEmbeds(statusEmbeds).setActionRow(statusButtons).queue();
                return;
        }

        // 예외 상황 폴백 (버튼이 없으면 빈 화면 처리)
        List<Button> fallbackButtons = getTabButtons(action, monsterName, monsterData);
        if (fallbackButtons.isEmpty()) event.editMessageEmbeds(embed.build()).setComponents().queue();
        else event.editMessageEmbeds(embed.build()).setActionRow(fallbackButtons).queue();
    }

    // 💡 육질 전용 페이지 전송 메서드 (기본 정보 생략용)
    private void sendHitzonePage(SlashCommandInteractionEvent slashEvent, ButtonInteractionEvent buttonEvent,
            String monsterName, JsonObject monsterData, boolean isEdit) {
        
        EmbedBuilder embed = new EmbedBuilder();
        try {
            if (monsterData.has("color")) embed.setColor(Color.decode(monsterData.get("color").getAsString()));
            else embed.setColor(new Color(255, 255, 255));
        } catch (Exception e) {
            embed.setColor(new Color(255, 255, 255));
        }

        if (monsterData.has("thumbnail")) embed.setThumbnail(monsterData.get("thumbnail").getAsString());

        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String titleText = "# " + icon + monsterName + "\n";
        String hitzoneText = getArrayAsString(monsterData, "hitzone");
        List<MessageEmbed> hitzoneEmbeds = splitTextToEmbeds(embed, titleText + "\n" + hitzoneText);

        List<Button> buttons = getTabButtons("hitzone", monsterName, monsterData);

        if (isEdit) {
            if (buttons.isEmpty()) buttonEvent.editMessageEmbeds(hitzoneEmbeds).setComponents().queue();
            else buttonEvent.editMessageEmbeds(hitzoneEmbeds).setActionRow(buttons).queue();
        } else {
            if (buttons.isEmpty()) slashEvent.replyEmbeds(hitzoneEmbeds).queue();
            else slashEvent.replyEmbeds(hitzoneEmbeds).addActionRow(buttons).queue();
        }
    }

    private void sendBasicPage(SlashCommandInteractionEvent slashEvent, ButtonInteractionEvent buttonEvent,
            String monsterName, JsonObject monsterData, boolean isEdit) {
        
        EmbedBuilder embed = new EmbedBuilder();

        try {
            if (monsterData.has("color")) {
                embed.setColor(Color.decode(monsterData.get("color").getAsString()));
            } else {
                embed.setColor(new Color(184, 56, 56));
            }
        } catch (Exception e) {
            embed.setColor(new Color(184, 56, 56));
        }

        if (monsterData.has("thumbnail")) {
            embed.setThumbnail(monsterData.get("thumbnail").getAsString());
        }

        String icon = monsterData.has("icon") ? monsterData.get("icon").getAsString() + " " : "";
        String species = monsterData.has("species") ? monsterData.get("species").getAsString() : "";
        String threatLevel = monsterData.has("threat_level") ? monsterData.get("threat_level").getAsString() : "";
        String info = getArrayAsString(monsterData, "info");
        String habitat = monsterData.has("habitat") ? monsterData.get("habitat").getAsString() : "정보 없음";

        StringBuilder basicDesc = new StringBuilder();
        basicDesc.append("# ").append(icon).append(monsterName).append("\n");
        
        if (!species.isEmpty()) {
            basicDesc.append("**【 ").append(species).append(" 】**\n\n");
        }
        if (!info.equals("정보가 없습니다.")) {
            basicDesc.append(info).append("\n\n");
        }

        if (monsterData.has("habitat")) {
            basicDesc.append("**《 서식지 》**\n> ").append(habitat).append("\n\n");
        }
        if (!threatLevel.isEmpty()) {
            basicDesc.append("**《 위험도 》**\n> ").append(threatLevel).append("\n\n");
        }

        if (monsterData.has("breakable_parts")) {
            basicDesc.append("**《 파괴/절단 가능 부위 》**\n");
            if (monsterData.get("breakable_parts").isJsonArray()) {
                monsterData.getAsJsonArray("breakable_parts").forEach(el -> 
                    basicDesc.append("> ").append(el.getAsString().replace("\n", "").trim()).append("\n")
                );
            } else {
                for (String line : monsterData.get("breakable_parts").getAsString().split("\n")) {
                    basicDesc.append("> ").append(line.trim()).append("\n");
                }
            }
            basicDesc.append("\n");
        }
        
        if (monsterData.has("weak_point")) {
            basicDesc.append("**《 약점 》**\n");
            if (monsterData.get("weak_point").isJsonArray()) {
                monsterData.getAsJsonArray("weak_point").forEach(el -> 
                    basicDesc.append("> ").append(el.getAsString().replace("\n", "").trim()).append("\n")
                );
            } else {
                for (String line : monsterData.get("weak_point").getAsString().split("\n")) {
                    basicDesc.append("> ").append(line.trim()).append("\n");
                }
            }
            basicDesc.append("\n");
        }

        if (monsterData.has("element_weakness")) {
            basicDesc.append("**《 추천 속성 》**\n");
            if (monsterData.get("element_weakness").isJsonArray()) {
                monsterData.getAsJsonArray("element_weakness").forEach(el -> 
                    basicDesc.append("> ").append(el.getAsString().replace("\n", "").trim()).append("\n")
                );
            } else {
                for (String line : monsterData.get("element_weakness").getAsString().split("\n")) {
                    basicDesc.append("> ").append(line.trim()).append("\n");
                }
            }
            basicDesc.append("\n");
        }

        embed.setDescription(basicDesc.toString().trim());
        List<Button> buttons = getTabButtons("basic", monsterName, monsterData);

        if (isEdit) {
            if (buttons.isEmpty()) buttonEvent.editMessageEmbeds(embed.build()).setComponents().queue();
            else buttonEvent.editMessageEmbeds(embed.build()).setActionRow(buttons).queue();
        } else {
            if (buttons.isEmpty()) slashEvent.replyEmbeds(embed.build()).queue();
            else slashEvent.replyEmbeds(embed.build()).addActionRow(buttons).queue();
        }
    }

    // 💡 텍스트가 길면 자동으로 임베드를 여러 장으로 예쁘게 나눠주는 마법의 메서드 (절단면 최적화 버전)
    private List<MessageEmbed> splitTextToEmbeds(EmbedBuilder baseEmbed, String fullText) {
        List<MessageEmbed> embeds = new ArrayList<>();
        int maxLength = 1800; // 안전 분할 기준

        if (fullText.length() <= maxLength) {
            baseEmbed.setDescription(fullText);
            embeds.add(baseEmbed.build());
            return embeds;
        }

        String remainingText = fullText;
        boolean isFirst = true;

        while (remainingText.length() > 0) {
            if (remainingText.length() <= maxLength) {
                EmbedBuilder eb = new EmbedBuilder(baseEmbed);
                eb.setDescription(remainingText);
                if (!isFirst) eb.setThumbnail(null); // 두 번째 장부터는 썸네일 숨김
                embeds.add(eb.build());
                break;
            }

            // 💡 절단면 지능형 탐색: 덩어리가 중간에 쪼개지지 않도록 빈 줄(\n\n)을 최우선으로 찾습니다.
            int splitIndex = remainingText.lastIndexOf("\n\n", maxLength);
            
            // 만약 빈 줄이 없거나 너무 앞에 있어서 페이지가 텅 비게 된다면, 다음 우선순위 탐색
            if (splitIndex == -1 || splitIndex < maxLength - 800) {
                int altIndex = remainingText.lastIndexOf("\n**", maxLength); // 새로운 부위의 시작점
                if (altIndex > splitIndex) splitIndex = altIndex;
            }
            if (splitIndex == -1 || splitIndex < maxLength - 800) {
                int altIndex = remainingText.lastIndexOf("\n<:", maxLength); // 아이콘의 시작점
                if (altIndex > splitIndex) splitIndex = altIndex;
            }
            if (splitIndex == -1) {
                splitIndex = remainingText.lastIndexOf("\n", maxLength); // 최후의 수단: 아무 줄바꿈
            }
            if (splitIndex == -1) {
                splitIndex = maxLength; // 진짜 안 되면 강제 절단
            }

            String chunk = remainingText.substring(0, splitIndex);
            EmbedBuilder eb = new EmbedBuilder(baseEmbed);
            eb.setDescription(chunk.trim());
            if (!isFirst) eb.setThumbnail(null);
            embeds.add(eb.build());

            // 잘라낸 뒷부분부터 다시 반복
            remainingText = remainingText.substring(splitIndex).trim();
            isFirst = false;
        }
        return embeds;
    }
    
}